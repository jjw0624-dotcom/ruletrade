"""Repository-native adjusted-close snapshot adapter for v2 daily Values.

The maintained DatasetRegistry is deliberately price-only. This adapter makes
that limitation executable: it creates a pinned DailyMarketSnapshot for the
one field the registry can actually supply and exposes negative availability
for every other daily market field.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
from typing import Mapping

from ruletrade.datasets import DatasetRegistry
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot, MarketField, PriceBasis
from ruletrade.strategy.v2.semantic_types import Clock


class DailyDatasetProviderError(ValueError):
    pass


@dataclass(frozen=True)
class DailyFieldAvailability:
    field: MarketField
    basis: PriceBasis
    available: bool
    reason: str | None = None


@dataclass(frozen=True)
class DailyDatasetContract:
    """Truthful contract for a particular DatasetRegistry snapshot source."""

    provider_id: str
    clock: Clock
    calendar: str
    effective_observation: str
    available_at: str | None
    asset_id_mapping: bool
    point_in_time_membership: bool
    fields: tuple[DailyFieldAvailability, ...]

    def supports(self, field: MarketField, basis: PriceBasis) -> bool:
        return any(
            item.field == field and item.basis == basis and item.available
            for item in self.fields
        )


class DatasetDailySnapshotProvider:
    """Adapts the maintained adjusted-close CSV contract without inventing OHLCV."""

    _ADJUSTED_CLOSE = DailyFieldAvailability(MarketField.CLOSE, PriceBasis.ADJUSTED, True)

    def __init__(self, registry: DatasetRegistry) -> None:
        self.registry = registry

    @property
    def contract(self) -> DailyDatasetContract:
        unavailable: list[DailyFieldAvailability] = []
        for field in (MarketField.OPEN, MarketField.HIGH, MarketField.LOW, MarketField.CLOSE):
            if field != MarketField.CLOSE:
                unavailable.append(
                    DailyFieldAvailability(field, PriceBasis.RAW, False, "price_only_adjusted_close_csv")
                )
        unavailable.append(
            DailyFieldAvailability(
                MarketField.VOLUME, PriceBasis.RAW_SHARES, False, "price_only_adjusted_close_csv"
            )
        )
        return DailyDatasetContract(
            provider_id="ruletrade.dataset_registry.csv@1",
            clock=Clock(id="daily-close"),
            calendar="dataset_date_index",
            effective_observation="completed_daily_close",
            available_at=None,
            asset_id_mapping=False,
            point_in_time_membership=False,
            fields=(self._ADJUSTED_CLOSE, *unavailable),
        )

    def load_snapshot(
        self,
        dataset_id: str,
        domains: Mapping[str, tuple[str, ...]],
    ) -> DailyMarketSnapshot:
        if not domains:
            raise DailyDatasetProviderError("at least one static domain is required")
        symbols = tuple(dict.fromkeys(symbol for members in domains.values() for symbol in members))
        if not symbols:
            raise DailyDatasetProviderError("domains must contain at least one symbol")

        frame = self.registry.load_prices(dataset_id, list(symbols))
        dates = tuple(index.date().isoformat() for index in frame.index)
        series = {
            symbol: {
                "close:adjusted": tuple(Decimal(str(value)) for value in frame[symbol].tolist())
            }
            for symbol in symbols
        }
        digest = sha256()
        digest.update(dataset_id.encode("utf-8"))
        for date in dates:
            digest.update(date.encode("utf-8"))
        for symbol in symbols:
            digest.update(symbol.encode("utf-8"))
            for value in series[symbol]["close:adjusted"]:
                digest.update(str(value).encode("utf-8"))
        return DailyMarketSnapshot(
            snapshot_id=f"dataset-registry:{dataset_id}:{digest.hexdigest()[:16]}",
            clock=self.contract.clock,
            series=series,
            domains=dict(domains),
            dates=dates,
        )
