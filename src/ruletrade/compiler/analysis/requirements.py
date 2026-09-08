from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ruletrade.ir.strategy import (
    AssetSetOp,
    MonthlyScheduleOp,
    RandomNOp,
    StrategyIR,
    TrailingReturnOp,
)


@dataclass(frozen=True)
class ScheduleRequirement:
    source_component_id: str
    operation: Literal["schedule.monthly"]
    day: int


@dataclass(frozen=True)
class RandomRequirement:
    source_component_id: str
    resample: Literal["once", "per_event"]


@dataclass(frozen=True)
class DailyHistoryRequirement:
    source_component_id: str
    symbols: tuple[str, ...]
    lookback_bars: int
    observation_count: int
    price_field: Literal["adjusted_close"] = "adjusted_close"
    resolution: Literal["daily"] = "daily"


@dataclass(frozen=True)
class StrategyRequirements:
    assets: tuple[str, ...]
    schedules: tuple[ScheduleRequirement, ...]
    operations: tuple[str, ...]
    random_selections: tuple[RandomRequirement, ...]
    daily_history: tuple[DailyHistoryRequirement, ...] = ()


def analyze_strategy_ir(strategy_ir: StrategyIR) -> StrategyRequirements:
    """Collect immutable domain/backend requirements from validated Strategy IR."""

    assets: set[str] = set()
    schedules: list[ScheduleRequirement] = []
    random_selections: list[RandomRequirement] = []
    operations: set[str] = set()
    daily_history: list[DailyHistoryRequirement] = []
    operations_by_id = {operation.id: operation for operation in strategy_ir.operations}
    for operation in strategy_ir.operations:
        operations.add(operation.operation)
        if isinstance(operation, AssetSetOp):
            assets.update(operation.symbols)
        elif isinstance(operation, MonthlyScheduleOp):
            schedules.append(
                ScheduleRequirement(
                    source_component_id=operation.provenance.component_id,
                    operation=operation.operation,
                    day=operation.day,
                )
            )
        elif isinstance(operation, RandomNOp):
            random_selections.append(
                RandomRequirement(
                    source_component_id=operation.provenance.component_id,
                    resample=operation.resample,
                )
            )
        elif isinstance(operation, TrailingReturnOp):
            asset_set = operations_by_id.get(operation.assets)
            if isinstance(asset_set, AssetSetOp):
                daily_history.append(
                    DailyHistoryRequirement(
                        source_component_id=operation.provenance.component_id,
                        symbols=asset_set.symbols,
                        lookback_bars=operation.lookback_bars,
                        observation_count=operation.lookback_bars + 1,
                    )
                )
    return StrategyRequirements(
        assets=tuple(sorted(assets)),
        schedules=tuple(sorted(schedules, key=lambda item: item.source_component_id)),
        operations=tuple(sorted(operations)),
        random_selections=tuple(
            sorted(random_selections, key=lambda item: item.source_component_id)
        ),
        daily_history=tuple(sorted(daily_history, key=lambda item: item.source_component_id)),
    )
