from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest

from ruletrade.datasets import DatasetRegistry
from ruletrade.strategy.v2.daily_provider import (
    DailyDatasetProviderError,
    DatasetDailySnapshotProvider,
)
from ruletrade.strategy.v2.daily_values import MarketField, PriceBasis


def registry_with_prices(tmp_path: Path) -> DatasetRegistry:
    pd.DataFrame(
        {
            "date": ["2026-01-02", "2026-01-05", "2026-01-06"],
            "QQQ": [100, 101.5, 102],
            "VGT": [200, 201, 203],
        }
    ).to_csv(tmp_path / "daily.csv", index=False)
    return DatasetRegistry(tmp_path)


def test_dataset_registry_adapter_creates_a_pinned_adjusted_close_snapshot(tmp_path: Path) -> None:
    provider = DatasetDailySnapshotProvider(registry_with_prices(tmp_path))
    snapshot = provider.load_snapshot("daily", {"growth": ("QQQ", "VGT")})

    assert snapshot.dates == ("2026-01-02", "2026-01-05", "2026-01-06")
    assert snapshot.domains == {"growth": ("QQQ", "VGT")}
    assert snapshot.field_values("QQQ", MarketField.CLOSE, PriceBasis.ADJUSTED)[1] == Decimal("101.5")
    assert snapshot.snapshot_id.startswith("dataset-registry:daily:")

    again = provider.load_snapshot("daily", {"growth": ("QQQ", "VGT")})
    assert again.snapshot_id == snapshot.snapshot_id


def test_provider_contract_is_explicit_about_price_only_limits(tmp_path: Path) -> None:
    contract = DatasetDailySnapshotProvider(registry_with_prices(tmp_path)).contract

    assert contract.supports(MarketField.CLOSE, PriceBasis.ADJUSTED)
    assert not contract.supports(MarketField.CLOSE, PriceBasis.RAW)
    assert not contract.supports(MarketField.VOLUME, PriceBasis.RAW_SHARES)
    assert contract.available_at is None
    assert not contract.asset_id_mapping
    assert not contract.point_in_time_membership


def test_provider_rejects_an_empty_static_domain(tmp_path: Path) -> None:
    provider = DatasetDailySnapshotProvider(registry_with_prices(tmp_path))
    with pytest.raises(DailyDatasetProviderError, match="at least one"):
        provider.load_snapshot("daily", {})
