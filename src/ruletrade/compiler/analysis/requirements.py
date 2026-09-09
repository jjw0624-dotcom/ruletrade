from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ruletrade.ir.strategy import (
    AssetSetOp,
    DailyScheduleOp,
    ElapsedSessionsGateOp,
    FilterOp,
    MonthlyScheduleOp,
    QuarterlyScheduleOp,
    RandomNOp,
    RankOp,
    StrategyIR,
    TopNOp,
    TrailingReturnOp,
)


@dataclass(frozen=True)
class ScheduleRequirement:
    source_component_id: str
    operation: Literal["schedule.daily", "schedule.monthly", "schedule.quarterly"]
    day: int | None


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
class UserStateRequirement:
    state_id: str
    source_component_id: str
    scope: Literal["per_asset"] = "per_asset"
    value_type: Literal["trading_session_index"] = "trading_session_index"
    mutation: Literal["target_exit"] = "target_exit"


@dataclass(frozen=True)
class TradingCalendarRequirement:
    source_component_id: str
    symbols: tuple[str, ...]
    unit: Literal["completed_trading_sessions"] = "completed_trading_sessions"


@dataclass(frozen=True)
class StrategyRequirements:
    assets: tuple[str, ...]
    schedules: tuple[ScheduleRequirement, ...]
    operations: tuple[str, ...]
    random_selections: tuple[RandomRequirement, ...]
    daily_history: tuple[DailyHistoryRequirement, ...] = ()
    user_state: tuple[UserStateRequirement, ...] = ()
    trading_calendars: tuple[TradingCalendarRequirement, ...] = ()


def analyze_strategy_ir(strategy_ir: StrategyIR) -> StrategyRequirements:
    """Collect immutable domain/backend requirements from validated Strategy IR."""

    assets: set[str] = set()
    schedules: list[ScheduleRequirement] = []
    random_selections: list[RandomRequirement] = []
    operations: set[str] = set()
    daily_history: list[DailyHistoryRequirement] = []
    operations_by_id = {operation.id: operation for operation in strategy_ir.operations}

    def asset_symbols(operation_id: str) -> tuple[str, ...]:
        operation = operations_by_id.get(operation_id)
        if isinstance(operation, AssetSetOp):
            return operation.symbols
        if isinstance(operation, ElapsedSessionsGateOp):
            return asset_symbols(operation.candidates)
        if isinstance(operation, TopNOp):
            return asset_symbols(operation.ranked)
        if isinstance(operation, RankOp):
            return asset_symbols(operation.scores)
        if isinstance(operation, FilterOp):
            return asset_symbols(operation.scores)
        if isinstance(operation, TrailingReturnOp):
            return asset_symbols(operation.assets)
        return ()

    for operation in strategy_ir.operations:
        operations.add(operation.operation)
        if isinstance(operation, AssetSetOp):
            assets.update(operation.symbols)
        elif isinstance(operation, (DailyScheduleOp, MonthlyScheduleOp, QuarterlyScheduleOp)):
            schedules.append(
                ScheduleRequirement(
                    source_component_id=operation.provenance.component_id,
                    operation=operation.operation,
                    day=operation.day if not isinstance(operation, DailyScheduleOp) else None,
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
    user_state = tuple(
        UserStateRequirement(
            state_id=state.id,
            source_component_id=state.provenance.component_id,
        )
        for state in strategy_ir.user_state
    )
    trading_calendars = tuple(
        TradingCalendarRequirement(
            source_component_id=operation.provenance.component_id,
            symbols=asset_symbols(operation.id),
        )
        for operation in strategy_ir.operations
        if isinstance(operation, ElapsedSessionsGateOp)
    )
    return StrategyRequirements(
        assets=tuple(sorted(assets)),
        schedules=tuple(sorted(schedules, key=lambda item: item.source_component_id)),
        operations=tuple(sorted(operations)),
        random_selections=tuple(
            sorted(random_selections, key=lambda item: item.source_component_id)
        ),
        daily_history=tuple(sorted(daily_history, key=lambda item: item.source_component_id)),
        user_state=tuple(sorted(user_state, key=lambda item: item.state_id)),
        trading_calendars=tuple(
            sorted(trading_calendars, key=lambda item: item.source_component_id)
        ),
    )
