from decimal import Decimal

from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.catalog import (
    GrowthDefensiveCatalogRequest,
    MarketRegimeCatalogRequest,
    SingleAssetCatalogRequest,
    WeightedTopNCatalogRequest,
    create_catalog_strategy,
    strategy_catalog,
)
from ruletrade.strategy.v2.validation import validate_strategy_v2


client = TestClient(app)


def requests():
    return (
        SingleAssetCatalogRequest(
            catalog_id="single_asset_periodic",
            name="QQQ monthly",
            asset="QQQ",
            timeframe="monthly",
        ),
        MarketRegimeCatalogRequest(
            catalog_id="market_regime_rotation",
            name="Regime rotation",
            assets=("QQQ", "VGT", "SOXX", "SCHG"),
            trend_asset="SPY",
            trend_lookback=200,
            ranking_lookback=126,
            count=2,
            fallback_asset="TLT",
            timeframe="monthly",
        ),
        GrowthDefensiveCatalogRequest(
            catalog_id="growth_defensive",
            name="Growth defensive",
            growth_assets=("QQQ", "VGT", "SOXX", "SCHG"),
            growth_weight=Decimal("0.7"),
            defensive_asset="IEF",
            ranking_lookback=126,
            fallback_asset="TLT",
            timeframe="monthly",
        ),
        WeightedTopNCatalogRequest(
            catalog_id="weighted_top_n",
            name="Weighted momentum",
            assets=("QQQ", "VGT", "SOXX", "SCHG"),
            short_observations=21,
            long_observations=63,
            short_weight=Decimal("0.6"),
            long_weight=Decimal("0.4"),
            count=3,
            timeframe="monthly",
            missing_policy="require_all",
        ),
    )


def test_catalog_has_only_versioned_mvp_entries() -> None:
    entries = strategy_catalog()
    assert [entry.id for entry in entries] == [
        "single_asset_periodic",
        "market_regime_rotation",
        "growth_defensive",
        "weighted_top_n",
    ]
    assert all(entry.version == 1 for entry in entries)
    assert all(entry.parameters for entry in entries)


def test_every_catalog_entry_builds_valid_hashed_canonical() -> None:
    for request in requests():
        created = create_catalog_strategy(request)
        validate_strategy_v2(created.strategy)
        assert created.catalog_id == request.catalog_id
        assert created.catalog_version == 1
        assert created.source_hash == strategy_hash(created.strategy)
        assert created.strategy.metadata.name == request.name
        assert created.strategy.program is not None
        assert created.strategy.program.statements


def test_growth_defensive_catalog_preserves_parallel_sleeves() -> None:
    created = create_catalog_strategy(requests()[2])
    allocation = next(
        statement
        for statement in created.strategy.program.statements
        if statement.kind == "allocate"
    )
    assert [leg.weight for leg in allocation.legs] == [Decimal("0.7"), Decimal("0.3")]
    assert [leg.target.kind for leg in allocation.legs] == ["selection", "asset"]
    assert [leg.target.ref for leg in allocation.legs] == ["selected-growth", "IEF"]


def test_catalog_api_lists_entries_and_creates_canonical() -> None:
    listed = client.get("/v2/strategy-catalog")
    assert listed.status_code == 200
    assert [entry["id"] for entry in listed.json()] == [
        "single_asset_periodic",
        "market_regime_rotation",
        "growth_defensive",
        "weighted_top_n",
    ]

    created = client.post(
        "/v2/strategy-catalog/create",
        json={
            "catalog_id": "single_asset_periodic",
            "version": 1,
            "name": "QQQ monthly",
            "asset": "QQQ",
            "timeframe": "monthly",
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["catalog_id"] == "single_asset_periodic"
    assert body["catalog_version"] == 1
    assert body["source_hash"].startswith("sha256:")
    assert body["strategy"]["metadata"]["name"] == "QQQ monthly"


def test_catalog_api_rejects_unknown_or_invalid_parameters() -> None:
    unknown = client.post(
        "/v2/strategy-catalog/create",
        json={"catalog_id": "not-a-strategy", "version": 1, "name": "Nope"},
    )
    assert unknown.status_code == 422

    invalid = client.post(
        "/v2/strategy-catalog/create",
        json={
            "catalog_id": "growth_defensive",
            "version": 1,
            "name": "Invalid split",
            "growth_assets": ["QQQ", "VGT"],
            "growth_weight": "1.2",
            "defensive_asset": "IEF",
            "ranking_lookback": 126,
            "fallback_asset": "TLT",
            "timeframe": "monthly",
        },
    )
    assert invalid.status_code == 422
