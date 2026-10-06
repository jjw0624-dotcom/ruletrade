from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from ruletrade.datasets import DatasetRegistry
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.value_semantics import (
    DatasetValueEvaluator,
    ValueEvaluationRequest,
    value_capabilities,
)


class AssetResearchModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AssetSummary(AssetResearchModel):
    symbol: str
    name: str
    asset_type: Literal["ETF", "Equity"]
    data_status: Literal["available", "partial", "unavailable"]
    available_from: date | None
    available_to: date | None


class PricePoint(AssetResearchModel):
    date: date
    adjusted_close: Decimal


class AssetMetric(AssetResearchModel):
    id: str
    label: str
    status: Literal["available", "insufficient_history", "unavailable"]
    value: Decimal | None = None
    value_type: str | None = None
    reason: str | None = None
    value_definition: dict[str, object] | None = None


class StrategyMembership(AssetResearchModel):
    kind: Literal["asset_set", "group", "universe"]
    id: str
    label: str
    component_id: str | None = None


class HistoricalAssetContext(AssetResearchModel):
    run_id: str
    event_id: str
    session_id: date
    revision_id: str
    read_only: Literal[True] = True
    evidence: tuple[dict[str, object], ...]


class AssetDetail(AssetResearchModel):
    asset: AssetSummary
    as_of: date
    mode: Literal["current", "historical"]
    series: tuple[PricePoint, ...]
    metrics: tuple[AssetMetric, ...]
    memberships: tuple[StrategyMembership, ...]
    historical: HistoricalAssetContext | None = None
    capabilities: tuple[dict[str, object], ...]


class AssetCompareRequest(AssetResearchModel):
    symbols: tuple[str, ...] = Field(min_length=2, max_length=4)
    dataset_id: str = "synthetic_prices"
    as_of: date
    lookback_observations: int = Field(default=126, ge=1, le=1000)


class AssetCompareResponse(AssetResearchModel):
    as_of: date
    items: tuple[AssetDetail, ...]


_NAMES = {
    "SPY": ("SPDR S&P 500 ETF Trust", "ETF"),
    "QQQ": ("Invesco QQQ Trust", "ETF"),
    "VOO": ("Vanguard S&P 500 ETF", "ETF"),
    "VGT": ("Vanguard Information Technology ETF", "ETF"),
    "SOXX": ("iShares Semiconductor ETF", "ETF"),
    "SCHG": ("Schwab U.S. Large-Cap Growth ETF", "ETF"),
    "TLT": ("iShares 20+ Year Treasury Bond ETF", "ETF"),
    "IEF": ("iShares 7-10 Year Treasury Bond ETF", "ETF"),
}


class AssetResearchService:
    """Read-only, bounded Asset Workspace projection over maintained price data."""

    def __init__(self, datasets: DatasetRegistry) -> None:
        self.datasets = datasets
        self.values = DatasetValueEvaluator(datasets)

    def list_assets(self, dataset_id: str, query: str = "", limit: int = 20) -> tuple[AssetSummary, ...]:
        frame = self._frame(dataset_id)
        needle = query.strip().lower()
        items = []
        for symbol in frame.columns:
            name, kind = _NAMES.get(symbol.upper(), (symbol.upper(), "Equity"))
            if needle and needle not in symbol.lower() and needle not in name.lower():
                continue
            series = frame[symbol].dropna()
            items.append(AssetSummary(
                symbol=symbol.upper(),
                name=name,
                asset_type=kind,
                data_status="available" if len(series) == len(frame) else "partial",
                available_from=series.index[0].date() if len(series) else None,
                available_to=series.index[-1].date() if len(series) else None,
            ))
        return tuple(items[: max(1, min(limit, 50))])

    def detail(
        self,
        symbol: str,
        dataset_id: str,
        as_of: date,
        *,
        strategy: CanonicalStrategyV1 | None = None,
        historical: HistoricalAssetContext | None = None,
        lookback_observations: int = 126,
    ) -> AssetDetail:
        symbol = symbol.strip().upper()
        summary = next((item for item in self.list_assets(dataset_id, symbol, 50) if item.symbol == symbol), None)
        if summary is None:
            raise ValueError(f"Asset {symbol} is not available in {dataset_id}.")
        frame = self._frame(dataset_id)
        capped = frame.loc[frame.index.date <= as_of, symbol].dropna().tail(260)
        if capped.empty:
            raise ValueError(f"Asset {symbol} has no observations on or before {as_of}.")
        actual_as_of = capped.index[-1].date()
        price_expression = {"kind": "price", "asset": {"kind": "literal", "value_type": "asset", "value": symbol}}
        return_expression = {
            "kind": "indicator",
            "indicator_id": "trailing_return_indicator@1",
            "asset": {"kind": "literal", "value_type": "asset", "value": symbol},
            "parameters": {"lookback_bars": lookback_observations},
        }
        metrics = (
            self._metric("market.price.current", "Current adjusted price", price_expression, dataset_id, actual_as_of),
            self._metric("market.trailing_return", f"{lookback_observations}-observation return", return_expression, dataset_id, actual_as_of),
        )
        return AssetDetail(
            asset=summary,
            as_of=actual_as_of,
            mode="historical" if historical else "current",
            series=tuple(PricePoint(date=index.date(), adjusted_close=Decimal(str(value))) for index, value in capped.items()),
            metrics=metrics,
            memberships=self._memberships(strategy, symbol),
            historical=historical,
            capabilities=tuple(item.model_dump(mode="json") for item in value_capabilities()),
        )

    def compare(self, request: AssetCompareRequest) -> AssetCompareResponse:
        normalized = tuple(dict.fromkeys(symbol.strip().upper() for symbol in request.symbols))
        if len(normalized) != len(request.symbols):
            raise ValueError("Compare assets must be unique.")
        return AssetCompareResponse(
            as_of=request.as_of,
            items=tuple(self.detail(symbol, request.dataset_id, request.as_of, lookback_observations=request.lookback_observations) for symbol in normalized),
        )

    def _metric(self, identifier, label, expression, dataset_id, as_of):
        try:
            observed = self.values.evaluate(ValueEvaluationRequest(
                dataset_id=dataset_id, expression=expression, as_of=as_of, context="research"
            ))
            return AssetMetric(id=identifier, label=label, status="available", value=observed.observed, value_type=observed.value_type, value_definition=observed.value_definition)
        except Exception as exc:
            code = getattr(exc, "code", "unavailable")
            status = "insufficient_history" if code == "insufficient_history" else "unavailable"
            return AssetMetric(id=identifier, label=label, status=status, reason=str(exc), value_definition=expression)

    def _frame(self, dataset_id: str) -> pd.DataFrame:
        path = self.datasets.resolve(dataset_id)
        frame = pd.read_csv(path)
        if "date" not in frame:
            raise ValueError("Dataset requires a date column.")
        frame["date"] = pd.to_datetime(frame["date"], errors="raise")
        return frame.set_index("date").sort_index()

    @staticmethod
    def _memberships(strategy: CanonicalStrategyV1 | None, symbol: str) -> tuple[StrategyMembership, ...]:
        if strategy is None:
            return ()
        result: list[StrategyMembership] = []
        asset_sets = {item.id: item for item in strategy.definitions.asset_sets}
        asset_components = {
            str(item.config.get("asset_set_ref")): item.id
            for item in strategy.graph.components
            if item.primitive == "asset_set@1"
        }
        universe_components = {
            str(item.config.get("universe_ref")): item.id
            for item in strategy.graph.components
            if item.primitive == "universe@1"
        }
        component_ids = {item.id for item in strategy.graph.components}
        for item in strategy.definitions.asset_sets:
            if symbol in item.assets:
                result.append(StrategyMembership(
                    kind="asset_set", id=item.id, label=item.id.replace("_", " "),
                    component_id=asset_components.get(item.id),
                ))
        for group in strategy.definitions.groups:
            aset = asset_sets.get(group.asset_set_ref)
            if aset and symbol in aset.assets:
                result.append(StrategyMembership(
                    kind="group", id=group.id, label=group.name,
                    component_id=group.id if group.id in component_ids else asset_components.get(group.asset_set_ref),
                ))
        for universe in strategy.definitions.universes or ():
            asset_set_ref = universe.asset_set_ref
            if universe.source == "group" and universe.group_ref:
                group = next((item for item in strategy.definitions.groups if item.id == universe.group_ref), None)
                asset_set_ref = group.asset_set_ref if group else None
            aset = asset_sets.get(asset_set_ref or "")
            if aset and symbol in aset.assets:
                result.append(StrategyMembership(
                    kind="universe", id=universe.id, label=universe.name,
                    component_id=universe_components.get(universe.id) or asset_components.get(asset_set_ref or ""),
                ))
        return tuple(result)
