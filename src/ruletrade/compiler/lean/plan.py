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
class LeanFilterClause:
    operator: Literal["gt", "gte", "lt", "lte"]
    threshold: Decimal


@dataclass(frozen=True)
class LeanScoreTerm:
    value: "LeanValue"
    weight: Decimal


@dataclass(frozen=True)
class LeanValue:
    kind: Literal[
        "literal", "trailing_return", "current_price", "rolling_price", "scale",
        "weighted_score",
    ]
    value_type: Literal["decimal", "percentage", "money_per_share"]
    subject: Literal["asset", "candidate"] | None = None
    asset: str | None = None
    literal: Decimal | None = None
    observations: int | None = None
    aggregate: Literal["mean", "median", "min", "max"] | None = None
    operand: "LeanValue | None" = None
    factor: Decimal | None = None
    score_terms: tuple[LeanScoreTerm, ...] = ()
    missing_policy: Literal["require_all", "renormalize_available"] | None = None
    normalization: Literal["none", "sum_abs"] | None = None
    clamp_min: Decimal | None = None
    clamp_max: Decimal | None = None


@dataclass(frozen=True)
class LeanComparison:
    operator: Literal["gt", "gte", "lt", "lte"]
    left: LeanValue
    right: LeanValue


@dataclass(frozen=True)
class LeanMomentumSelection:
    id: str
    score_component_id: str
    rank_component_id: str
    selection_component_id: str
    symbols: tuple[str, ...]
    lookback_bars: int
    count: int
    direction: Literal["descending", "ascending"] = "descending"
    price_field: Literal["adjusted_close"] = "adjusted_close"
    filter_component_id: str | None = None
    filter_operator: Literal["gt", "gte", "lt", "lte"] | None = None
    filter_threshold: Decimal | None = None
    filter_clauses: tuple[LeanFilterClause, ...] = ()
    shortage_policy: Literal["require_full", "choose_all"] = "require_full"
    cooldown_state_id: str | None = None
    ranking_value: LeanValue | None = None
    eligibility: tuple[LeanComparison, ...] = ()
    score_field: str = "config.lookback_bars"


@dataclass(frozen=True)
class LeanCooldownState:
    id: str
    component_id: str
    symbols: tuple[str, ...]
    required_completed_sessions: int
    calendar_symbol: str


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
    weighting_method: Literal["equal", "proportional_score"] = "equal"
    allocation_component_id: str | None = None


@dataclass(frozen=True)
class LeanRebalance:
    id: str
    sleeve_ids: tuple[str, ...]
    snapshot_allocations: tuple["LeanSnapshotAllocation", ...] = ()
    exit_state_ids: tuple[str, ...] = ()
    predicate: "LeanTrailingReturnPredicate | None" = None
    condition: tuple[LeanComparison, ...] = ()
    condition_unknown_policy: Literal["retain", "otherwise"] = "retain"
    otherwise_sleeve_ids: tuple[str, ...] = ()
    otherwise_snapshot_allocations: tuple["LeanSnapshotAllocation", ...] = ()
    otherwise_exit_state_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class LeanTrailingReturnPredicate:
    component_id: str
    asset: str
    lookback_bars: int
    operator: Literal["gt", "gte", "lt", "lte"]
    threshold: Decimal


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
class LeanTemporalValue:
    """A scalar used by the bounded temporal/stateful execution profile."""

    kind: Literal[
        "current_price", "completed_weekly_price", "literal", "remembered",
        "bars_since_event",
    ]
    semantic_id: str
    asset: str | None = None
    literal: Decimal | None = None
    memory_id: str | None = None
    event_id: str | None = None
    clock_id: str | None = None


@dataclass(frozen=True)
class LeanTemporalCondition:
    semantic_id: str
    operator: Literal["gt", "gte", "lt", "lte", "eq", "neq"]
    left: LeanTemporalValue
    right: LeanTemporalValue
    required_state_key: str | None = None
    required_state_value: str | None = None
    after_event_id: str | None = None
    within_observations: int | None = None


@dataclass(frozen=True)
class LeanTemporalAction:
    kind: Literal["remember", "transition"]
    semantic_id: str
    memory_id: str | None = None
    value: LeanTemporalValue | None = None
    state_key: str | None = None
    from_value: str | None = None
    to_value: str | None = None


@dataclass(frozen=True)
class LeanTemporalEvent:
    semantic_id: str
    statement_id: str
    clock_id: str
    trigger: Literal["rising_edge", "while_true", "crosses_above", "crosses_below"]
    occurrence: Literal["every", "first"]
    condition: LeanTemporalCondition
    actions: tuple[LeanTemporalAction, ...]


@dataclass(frozen=True)
class LeanTemporalPolicyTarget:
    semantic_id: str
    state_key: str
    state_value: str
    target_kind: Literal["asset", "cash", "retain", "portfolio"]
    asset: str | None = None
    weight: Decimal = Decimal(1)
    allocation_method: Literal["equal", "fixed", "proportional_score"] = "fixed"
    legs: tuple["LeanTemporalAllocationLeg", ...] = ()


@dataclass(frozen=True)
class LeanTemporalAllocationLeg:
    """One typed downstream target selected by temporal policy precedence."""

    semantic_id: str
    target_kind: Literal["asset", "selection", "cash", "retain"]
    target_ref: str | None = None
    weight: Decimal | None = None


@dataclass(frozen=True)
class LeanTemporalProgram:
    """Versioned, deliberately bounded Event/State LEAN profile.

    Events execute in tuple order. Successful actions commit immediately, so
    later events and the policy observe the new checkpoint at the same close.
    """

    profile: Literal[
        "event-state-daily@1", "event-state-multiclock@1",
        "composable-semantic-execution@1",
    ]
    semantic_id: str
    checkpoint_identity: str
    operator_versions: tuple[tuple[str, str], ...]
    clock_id: str
    anchor_symbol: str
    initial_state: tuple[tuple[str, str], ...]
    events: tuple[LeanTemporalEvent, ...]
    policy_statement_id: str
    policy_targets: tuple[LeanTemporalPolicyTarget, ...]
    asset_universe: tuple[str, ...] = ()
    execution_order: tuple[str, ...] = (
        "data_clocks", "value_readiness", "conditions", "events", "state_memory",
        "policy", "universe", "score_rank", "selection_fallback",
        "allocation_aggregation", "order_intent", "checkpoint_evidence",
    )


@dataclass(frozen=True)
class LeanTemporalCheckpoint:
    """Validated state imported by a fresh generated LEAN algorithm process."""

    schema_version: Literal["ruletrade-temporal-checkpoint@1"]
    profile: Literal[
        "event-state-daily@1", "event-state-multiclock@1",
        "composable-semantic-execution@1",
    ]
    strategy_identity: str
    checkpoint_identity: str
    snapshot_id: str
    clock_id: str
    cutoff: str
    boundary_index: int
    operator_versions: tuple[tuple[str, str], ...]
    asset_universe: tuple[str, ...]
    statement_order: tuple[str, ...]
    state: tuple[tuple[str, str], ...]
    state_entered_cutoffs: tuple[tuple[str, int], ...]
    event_cutoffs: tuple[tuple[str, int], ...]
    event_truths: tuple[tuple[str, str], ...]
    event_counts: tuple[tuple[str, int], ...]
    memory: tuple[tuple[str, Decimal], ...]
    memory_capture_cutoffs: tuple[tuple[str, int], ...]
    memory_value_ids: tuple[tuple[str, str], ...]
    last_policy_target: str
    active_week_key: str = ""
    active_week_close: Decimal | None = None
    active_week_cutoff: str = ""
    completed_weekly_close: Decimal | None = None
    completed_weekly_source_cutoff: str = ""
    completed_weekly_available_cutoff: str = ""
    portfolio_target: str = ""
    integrity_hash: str = ""


@dataclass(frozen=True)
class LeanMonthlyEvent:
    id: str
    day: int
    anchor_symbol: str
    rebalance_ids: tuple[str, ...]
    execution: LeanOnDataExecution
    refresh_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class LeanDailyEvent:
    id: str
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
    daily_events: tuple[LeanDailyEvent, ...] = ()
    cooldown_states: tuple[LeanCooldownState, ...] = ()
    temporal_program: LeanTemporalProgram | None = None


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
    _unique_by_id(plan.daily_events, "daily event")
    _unique_by_id(plan.cooldown_states, "cooldown state")
    if plan.temporal_program is not None:
        event_ids = [item.semantic_id for item in plan.temporal_program.events]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("duplicate temporal event id")
        target_ids = [item.semantic_id for item in plan.temporal_program.policy_targets]
        if len(target_ids) != len(set(target_ids)):
            raise ValueError("duplicate temporal policy target id")

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
        daily_events=tuple(sorted(plan.daily_events, key=lambda item: item.id)),
        cooldown_states=tuple(sorted(plan.cooldown_states, key=lambda item: item.id)),
    )
