from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Literal


@dataclass(frozen=True)
class LeanSubscription:
    symbol: str
    security_type: Literal["equity"] = "equity"
    market: Literal["usa"] = "usa"
    resolution: Literal["daily"] = "daily"


@dataclass(frozen=True)
class LeanRandomSelection:
    id: str
    component_id: str
    symbols: tuple[str, ...]
    count: int
    resample: Literal["once", "per_event"]
    parameter_bindings_json: str


@dataclass(frozen=True)
class LeanMomentumSelection:
    id: str
    score_component_id: str
    rank_component_id: str
    symbols: tuple[str, ...]
    lookback_bars: int
    count: int
    direction: Literal["descending"] = "descending"
    price_field: Literal["adjusted_close"] = "adjusted_close"
    filter_component_id: str | None = None
    filter_operator: Literal["gt"] | None = None
    filter_threshold: Decimal | None = None


@dataclass(frozen=True)
class LeanTargetSleeve:
    id: str
    symbols: tuple[str, ...]
    total_weight: Decimal
    selection_id: str | None = None
    fallback_component_id: str | None = None
    fallback_symbols: tuple[str, ...] = ()
    source_sleeve_component_id: str | None = None
    local_total_weight: Decimal | None = None
    source_allocation: Decimal | None = None


@dataclass(frozen=True)
class LeanRebalance:
    id: str
    sleeve_ids: tuple[str, ...]
    snapshot_allocations: tuple["LeanSnapshotAllocation", ...] = ()


@dataclass(frozen=True)
class LeanTargetSnapshot:
    id: str
    sleeve_ids: tuple[str, ...]
    source_sleeve_component_id: str


@dataclass(frozen=True)
class LeanSnapshotAllocation:
    snapshot_id: str
    factor: Decimal
    source_sleeve_component_id: str


@dataclass(frozen=True)
class LeanOnDataExecution:
    required_symbols: tuple[str, ...]


@dataclass(frozen=True)
class LeanMonthlyEvent:
    id: str
    day: int
    anchor_symbol: str
    rebalance_ids: tuple[str, ...]
    execution: LeanOnDataExecution
    refresh_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class LeanQuarterlyEvent:
    id: str
    day: int
    anchor_symbol: str
    rebalance_ids: tuple[str, ...]
    execution: LeanOnDataExecution
    refresh_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class LeanPlan:
    strategy_identity: str
    subscriptions: tuple[LeanSubscription, ...]
    random_selections: tuple[LeanRandomSelection, ...]
    target_sleeves: tuple[LeanTargetSleeve, ...]
    rebalances: tuple[LeanRebalance, ...]
    monthly_events: tuple[LeanMonthlyEvent, ...]
    momentum_selections: tuple[LeanMomentumSelection, ...] = ()
    target_snapshots: tuple[LeanTargetSnapshot, ...] = ()
    quarterly_events: tuple[LeanQuarterlyEvent, ...] = ()


def _unique_by_id(items: tuple[object, ...], label: str) -> None:
    ids = [getattr(item, "id") for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError(f"duplicate {label} id")


def normalize_lean_plan(plan: LeanPlan) -> LeanPlan:
    """Return stable, deduplicated LEAN inputs and grouped equivalent events."""

    subscriptions: dict[str, LeanSubscription] = {}
    for item in plan.subscriptions:
        existing = subscriptions.get(item.symbol)
        if existing is not None and existing != item:
            raise ValueError(f"conflicting subscription for {item.symbol}")
        subscriptions[item.symbol] = item

    _unique_by_id(plan.random_selections, "random selection")
    _unique_by_id(plan.momentum_selections, "momentum selection")
    _unique_by_id(plan.target_sleeves, "target sleeve")
    _unique_by_id(plan.rebalances, "rebalance")
    _unique_by_id(plan.monthly_events, "monthly event")
    _unique_by_id(plan.target_snapshots, "target snapshot")
    _unique_by_id(plan.quarterly_events, "quarterly event")

    grouped_events: dict[tuple[int, str, LeanOnDataExecution], LeanMonthlyEvent] = {}
    for event in sorted(plan.monthly_events, key=lambda item: item.id):
        key = (event.day, event.anchor_symbol, event.execution)
        existing = grouped_events.get(key)
        if existing is None:
            grouped_events[key] = event
        else:
            grouped_events[key] = replace(
                existing,
                rebalance_ids=tuple(sorted(set(existing.rebalance_ids + event.rebalance_ids))),
                refresh_ids=tuple(sorted(set(existing.refresh_ids + event.refresh_ids))),
            )

    grouped_quarterly: dict[tuple[int, str, LeanOnDataExecution], LeanQuarterlyEvent] = {}
    for event in sorted(plan.quarterly_events, key=lambda item: item.id):
        key = (event.day, event.anchor_symbol, event.execution)
        existing = grouped_quarterly.get(key)
        if existing is None:
            grouped_quarterly[key] = event
        else:
            grouped_quarterly[key] = replace(
                existing,
                rebalance_ids=tuple(sorted(set(existing.rebalance_ids + event.rebalance_ids))),
                refresh_ids=tuple(sorted(set(existing.refresh_ids + event.refresh_ids))),
            )

    return replace(
        plan,
        subscriptions=tuple(subscriptions[key] for key in sorted(subscriptions)),
        random_selections=tuple(sorted(plan.random_selections, key=lambda item: item.id)),
        momentum_selections=tuple(sorted(plan.momentum_selections, key=lambda item: item.id)),
        target_sleeves=tuple(sorted(plan.target_sleeves, key=lambda item: item.id)),
        rebalances=tuple(sorted(plan.rebalances, key=lambda item: item.id)),
        monthly_events=tuple(sorted(grouped_events.values(), key=lambda item: item.id)),
        target_snapshots=tuple(sorted(plan.target_snapshots, key=lambda item: item.id)),
        quarterly_events=tuple(sorted(grouped_quarterly.values(), key=lambda item: item.id)),
    )
