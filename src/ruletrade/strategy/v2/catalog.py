"""Versioned fixed-strategy catalog for the MVP creation path.

Catalog forms are intentionally narrower than the general Builder.  They compile
through the same backend-owned V2 authoring operations, so catalog Strategies
remain ordinary Canonical documents and ordinary immutable Revisions.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.authoring import (
    ApplyV2AuthoringRequest,
    CommitMarketRegimeRotationIntent,
    CommitSingleAssetIntent,
    CommitSplitPortfolioIntent,
    CommitWeightedScoreIntent,
    ProgramStrategyTemplateRequest,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.models import CanonicalStrategyV2, Symbol
from ruletrade.strategy.v2.semantic_types import FrozenModel


class CatalogParameter(FrozenModel):
    id: str
    label: str
    kind: Literal["asset", "assets", "integer", "decimal", "timeframe", "policy"]
    required: bool = True


class StrategyCatalogEntry(FrozenModel):
    id: str
    version: int
    name: str
    description: str
    parameters: tuple[CatalogParameter, ...]


CATALOG: tuple[StrategyCatalogEntry, ...] = (
    StrategyCatalogEntry(
        id="single_asset_periodic",
        version=1,
        name="Single asset periodic",
        description="Hold one asset and rebalance on a fixed clock.",
        parameters=(
            CatalogParameter(id="asset", label="Asset", kind="asset"),
            CatalogParameter(id="timeframe", label="Rebalance", kind="timeframe"),
        ),
    ),
    StrategyCatalogEntry(
        id="market_regime_rotation",
        version=1,
        name="Market regime rotation",
        description="Filter by a completed trend observation, rank candidates, and use an explicit fallback.",
        parameters=(
            CatalogParameter(id="assets", label="Candidate assets", kind="assets"),
            CatalogParameter(id="trend_asset", label="Trend asset", kind="asset"),
            CatalogParameter(id="trend_lookback", label="Trend observations", kind="integer"),
            CatalogParameter(id="ranking_lookback", label="Ranking observations", kind="integer"),
            CatalogParameter(id="count", label="Top N", kind="integer"),
            CatalogParameter(id="fallback_asset", label="Fallback asset", kind="asset"),
            CatalogParameter(id="timeframe", label="Rebalance", kind="timeframe"),
        ),
    ),
    StrategyCatalogEntry(
        id="growth_defensive",
        version=1,
        name="Growth and Defensive",
        description="Split capital between ranked Growth assets and one Defensive asset.",
        parameters=(
            CatalogParameter(id="growth_assets", label="Growth assets", kind="assets"),
            CatalogParameter(id="growth_weight", label="Growth share", kind="decimal"),
            CatalogParameter(id="defensive_asset", label="Defensive asset", kind="asset"),
            CatalogParameter(id="ranking_lookback", label="Ranking observations", kind="integer"),
            CatalogParameter(id="fallback_asset", label="Shortage fallback", kind="asset"),
            CatalogParameter(id="timeframe", label="Rebalance", kind="timeframe"),
        ),
    ),
    StrategyCatalogEntry(
        id="weighted_top_n",
        version=1,
        name="Weighted Top N",
        description="Rank a fixed universe with a two-horizon weighted score and hold Top N.",
        parameters=(
            CatalogParameter(id="assets", label="Candidate assets", kind="assets"),
            CatalogParameter(id="short_observations", label="Short observations", kind="integer"),
            CatalogParameter(id="long_observations", label="Long observations", kind="integer"),
            CatalogParameter(id="short_weight", label="Short weight", kind="decimal"),
            CatalogParameter(id="long_weight", label="Long weight", kind="decimal"),
            CatalogParameter(id="count", label="Top N", kind="integer"),
            CatalogParameter(id="timeframe", label="Rebalance", kind="timeframe"),
            CatalogParameter(id="missing_policy", label="Missing data", kind="policy"),
        ),
    ),
)


class SingleAssetCatalogRequest(FrozenModel):
    catalog_id: Literal["single_asset_periodic"]
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=100)
    asset: Symbol
    timeframe: Literal["daily", "monthly"] = "monthly"


class MarketRegimeCatalogRequest(FrozenModel):
    catalog_id: Literal["market_regime_rotation"]
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=100)
    assets: tuple[Symbol, ...] = Field(min_length=2, max_length=100)
    trend_asset: Symbol
    trend_lookback: Annotated[int, Field(ge=2, le=2000)]
    ranking_lookback: Annotated[int, Field(ge=2, le=2000)]
    count: Annotated[int, Field(ge=1, le=100)]
    fallback_asset: Symbol
    timeframe: Literal["daily", "monthly"] = "monthly"


class GrowthDefensiveCatalogRequest(FrozenModel):
    catalog_id: Literal["growth_defensive"]
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=100)
    growth_assets: tuple[Symbol, ...] = Field(min_length=2, max_length=100)
    growth_weight: Annotated[Decimal, Field(gt=0, lt=1)] = Decimal("0.7")
    defensive_asset: Symbol
    ranking_lookback: Annotated[int, Field(ge=2, le=2000)] = 126
    fallback_asset: Symbol
    timeframe: Literal["daily", "monthly"] = "monthly"


class WeightedTopNCatalogRequest(FrozenModel):
    catalog_id: Literal["weighted_top_n"]
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=100)
    assets: tuple[Symbol, ...] = Field(min_length=3, max_length=100)
    short_observations: Annotated[int, Field(ge=2, le=2000)] = 21
    long_observations: Annotated[int, Field(ge=2, le=2000)] = 63
    short_weight: Annotated[Decimal, Field(gt=0)] = Decimal("0.6")
    long_weight: Annotated[Decimal, Field(gt=0)] = Decimal("0.4")
    count: Annotated[int, Field(ge=1, le=100)] = 3
    timeframe: Literal["daily", "monthly"] = "monthly"
    missing_policy: Literal["require_all", "renormalize_available"] = "require_all"


CreateCatalogStrategyRequest = Annotated[
    SingleAssetCatalogRequest
    | MarketRegimeCatalogRequest
    | GrowthDefensiveCatalogRequest
    | WeightedTopNCatalogRequest,
    Field(discriminator="catalog_id"),
]


class CreateCatalogStrategyResponse(FrozenModel):
    catalog_id: str
    catalog_version: int
    strategy: CanonicalStrategyV2
    source_hash: str


def strategy_catalog() -> tuple[StrategyCatalogEntry, ...]:
    return CATALOG


def create_catalog_strategy(request: CreateCatalogStrategyRequest) -> CreateCatalogStrategyResponse:
    source = create_program_strategy_template(ProgramStrategyTemplateRequest(name=request.name))
    if isinstance(request, SingleAssetCatalogRequest):
        operation = CommitSingleAssetIntent(
            kind="commit_single_asset_intent",
            investment_id="catalog-investment",
            investment_name="Investment",
            asset_set_id="catalog-assets",
            asset=request.asset,
            timeframe=request.timeframe,
            timing_meaning="rebalance",
        )
    elif isinstance(request, MarketRegimeCatalogRequest):
        operation = CommitMarketRegimeRotationIntent(
            kind="commit_market_regime_rotation_intent",
            assets=request.assets,
            trend_asset=request.trend_asset,
            trend_lookback=request.trend_lookback,
            ranking_lookback=request.ranking_lookback,
            count=request.count,
            fallback_asset=request.fallback_asset,
            timeframe=request.timeframe,
        )
    elif isinstance(request, GrowthDefensiveCatalogRequest):
        operation = CommitSplitPortfolioIntent(
            kind="commit_split_portfolio_intent",
            growth_assets=request.growth_assets,
            growth_weight=request.growth_weight,
            defensive_asset=request.defensive_asset,
            ranking_lookback=request.ranking_lookback,
            fallback_asset=request.fallback_asset,
            timeframe=request.timeframe,
        )
    else:
        operation = CommitWeightedScoreIntent(
            kind="commit_weighted_score_intent",
            assets=request.assets,
            short_observations=request.short_observations,
            long_observations=request.long_observations,
            short_weight=request.short_weight,
            long_weight=request.long_weight,
            count=request.count,
            timeframe=request.timeframe,
            missing_policy=request.missing_policy,
        )
    strategy = apply_v2_authoring(
        ApplyV2AuthoringRequest(
            strategy=source,
            expected_source_hash=strategy_hash(source),
            operation=operation,
        )
    ).strategy
    return CreateCatalogStrategyResponse(
        catalog_id=request.catalog_id,
        catalog_version=request.version,
        strategy=strategy,
        source_hash=strategy_hash(strategy),
    )
