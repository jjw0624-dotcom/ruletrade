from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal

from ruletrade.compiler.analysis import StrategyRequirements
from ruletrade.compiler.lean.plan import (
    LeanCooldownState,
    LeanDailyEvent,
    LeanMomentumSelection,
    LeanMonthlyEvent,
    LeanOnDataExecution,
    LeanPlan,
    LeanQuarterlyEvent,
    LeanRandomSelection,
    LeanRebalance,
    LeanSnapshotAllocation,
    LeanSubscription,
    LeanTargetSleeve,
    LeanTargetSnapshot,
    normalize_lean_plan,
)
from ruletrade.ir.strategy import (
    AssetSetOp,
    DailyScheduleOp,
    ElapsedSessionsGateOp,
    EqualWeightOp,
    FilterOp,
    FirstNonEmptyTargetsOp,
    MergeTargetsOp,
    MonthlyScheduleOp,
    ObserveTargetExitsOp,
    QuarterlyScheduleOp,
    RandomNOp,
    RankOp,
    RebalanceOp,
    RetainTargetsOp,
    ScaleTargetsOp,
    StrategyIR,
    TopNOp,
    TrailingReturnOp,
)


class LeanLoweringError(ValueError):
    pass


@dataclass(frozen=True)
class _LoweredTargets:
    sleeves: tuple[LeanTargetSleeve, ...] = ()
    snapshot_allocations: tuple[LeanSnapshotAllocation, ...] = ()
    exit_state_ids: tuple[str, ...] = ()

    def merged(self, other: _LoweredTargets) -> _LoweredTargets:
        return _LoweredTargets(
            sleeves=self.sleeves + other.sleeves,
            snapshot_allocations=self.snapshot_allocations + other.snapshot_allocations,
            exit_state_ids=self.exit_state_ids + other.exit_state_ids,
        )


def lower_strategy_ir_to_lean_plan(
    strategy_ir: StrategyIR,
    requirements: StrategyRequirements,
) -> LeanPlan:
    """Lower backend-independent Strategy IR into the LEAN-specific backend IR."""

    operations = {operation.id: operation for operation in strategy_ir.operations}
    history_requirements = {
        requirement.source_component_id: requirement
        for requirement in requirements.daily_history
    }
    selections: dict[str, LeanRandomSelection] = {}
    momentum_selections: dict[str, LeanMomentumSelection] = {}
    cooldown_states: dict[str, LeanCooldownState] = {}
    sleeves: dict[str, LeanTargetSleeve] = {}
    snapshots: dict[str, LeanTargetSnapshot] = {}

    calendar_requirements = {
        requirement.source_component_id: requirement
        for requirement in requirements.trading_calendars
    }

    def lower_momentum_selection(
        top_n: TopNOp,
        selection_id: str,
        *,
        cooldown_state_id: str | None = None,
    ) -> tuple[str, ...]:
        rank = operations.get(top_n.ranked)
        rank_input = operations.get(rank.scores) if isinstance(rank, RankOp) else None
        filter_operation = rank_input if isinstance(rank_input, FilterOp) else None
        score = operations.get(filter_operation.scores) if filter_operation is not None else rank_input
        asset_set = operations.get(score.assets) if isinstance(score, TrailingReturnOp) else None
        if not isinstance(rank, RankOp) or not isinstance(score, TrailingReturnOp) or not isinstance(asset_set, AssetSetOp):
            raise LeanLoweringError("Top N must consume ranked trailing returns over an asset set")
        history = history_requirements.get(score.provenance.component_id)
        if history is None:
            raise LeanLoweringError("trailing return history requirement is missing")
        momentum_selections[selection_id] = LeanMomentumSelection(
            id=selection_id,
            score_component_id=score.provenance.component_id,
            rank_component_id=rank.provenance.component_id,
            selection_component_id=top_n.provenance.component_id,
            symbols=asset_set.symbols,
            lookback_bars=history.lookback_bars,
            count=top_n.count,
            direction=rank.direction,
            price_field=history.price_field,
            filter_component_id=(
                filter_operation.provenance.component_id
                if filter_operation is not None
                else None
            ),
            filter_operator=(filter_operation.operator if filter_operation is not None else None),
            filter_threshold=(filter_operation.threshold if filter_operation is not None else None),
            cooldown_state_id=cooldown_state_id,
        )
        return asset_set.symbols

    def lower_sleeve(operation_id: str) -> LeanTargetSleeve:
        operation = operations.get(operation_id)
        if not isinstance(operation, EqualWeightOp):
            raise LeanLoweringError(f"{operation_id} is not an equal-weight operation")
        upstream = operations.get(operation.assets)
        selection_id: str | None = None
        if isinstance(upstream, RandomNOp):
            asset_set = operations.get(upstream.assets)
            if not isinstance(asset_set, AssetSetOp):
                raise LeanLoweringError("random selection input must be a market asset set")
            symbols = asset_set.symbols
            selection_id = upstream.id
            selections[selection_id] = LeanRandomSelection(
                id=selection_id,
                component_id=upstream.provenance.component_id,
                symbols=symbols,
                count=upstream.count,
                resample=upstream.resample,
                parameter_bindings_json=upstream.parameter_bindings_json,
            )
        elif isinstance(upstream, TopNOp):
            selection_id = upstream.id
            symbols = lower_momentum_selection(upstream, selection_id)
        elif isinstance(upstream, ElapsedSessionsGateOp):
            top_n = operations.get(upstream.candidates)
            if not isinstance(top_n, TopNOp):
                raise LeanLoweringError("cooldown v0 must consume a Top N candidate set")
            selection_id = upstream.id
            symbols = lower_momentum_selection(
                top_n,
                selection_id,
                cooldown_state_id=upstream.last_exit_state,
            )
            calendar = calendar_requirements.get(upstream.provenance.component_id)
            if calendar is None or not calendar.symbols:
                raise LeanLoweringError("cooldown trading-calendar requirement is missing")
            cooldown_states[upstream.last_exit_state] = LeanCooldownState(
                id=upstream.last_exit_state,
                component_id=upstream.provenance.component_id,
                symbols=symbols,
                required_completed_sessions=upstream.minimum_completed_sessions,
                calendar_symbol=calendar.symbols[0],
            )
        elif isinstance(upstream, AssetSetOp):
            symbols = upstream.symbols
        else:
            raise LeanLoweringError(
                "equal-weight input must be a market asset set or RandomN selection"
            )
        sleeve = LeanTargetSleeve(
            id=operation.id,
            symbols=symbols,
            total_weight=operation.total_weight,
            selection_id=selection_id,
        )
        sleeves[sleeve.id] = sleeve
        return sleeve

    def lower_targets(
        operation_id: str,
        *,
        scale: Decimal = Decimal(1),
        source_sleeve_component_id: str | None = None,
    ) -> _LoweredTargets:
        operation = operations.get(operation_id)
        if isinstance(operation, MergeTargetsOp):
            return lower_targets(
                operation.left,
                scale=scale,
                source_sleeve_component_id=source_sleeve_component_id,
            ).merged(lower_targets(
                operation.right,
                scale=scale,
                source_sleeve_component_id=source_sleeve_component_id,
            ))
        if isinstance(operation, ScaleTargetsOp):
            if source_sleeve_component_id is not None:
                raise LeanLoweringError("nested portfolio sleeves are not supported")
            retained = operations.get(operation.targets)
            if isinstance(retained, RetainTargetsOp):
                snapshot = lower_snapshot(retained)
                return _LoweredTargets(
                    snapshot_allocations=(
                        LeanSnapshotAllocation(
                            snapshot_id=snapshot.id,
                            factor=scale * operation.factor,
                            source_sleeve_component_id=operation.provenance.component_id,
                        ),
                    )
                )
            return lower_targets(
                operation.targets,
                scale=scale * operation.factor,
                source_sleeve_component_id=operation.provenance.component_id,
            )
        if isinstance(operation, EqualWeightOp):
            local = lower_sleeve(operation.id)
            lowered = replace(
                local,
                total_weight=local.total_weight * scale,
                source_sleeve_component_id=source_sleeve_component_id,
                local_total_weight=(
                    local.total_weight if source_sleeve_component_id is not None else None
                ),
                source_allocation=(
                    scale if source_sleeve_component_id is not None else None
                ),
            )
            sleeves[lowered.id] = lowered
            return _LoweredTargets(sleeves=(lowered,))
        if isinstance(operation, FirstNonEmptyTargetsOp):
            primary = operations.get(operation.primary)
            fallback = operations.get(operation.fallback)
            fallback_assets = (
                operations.get(fallback.assets)
                if isinstance(fallback, EqualWeightOp)
                else None
            )
            if not isinstance(primary, EqualWeightOp) or not isinstance(
                fallback, EqualWeightOp
            ):
                raise LeanLoweringError(
                    "first-non-empty targets require equal-weight primary and fallback"
                )
            if not isinstance(fallback_assets, AssetSetOp) or len(fallback_assets.symbols) != 1:
                raise LeanLoweringError("LEAN fallback v0 requires one fallback asset")
            if primary.total_weight != fallback.total_weight:
                raise LeanLoweringError("fallback allocation must match the primary allocation")
            primary_sleeve = lower_sleeve(primary.id)
            if primary_sleeve.selection_id not in momentum_selections:
                raise LeanLoweringError(
                    "LEAN fallback v0 requires a momentum Top N primary selection"
                )
            lowered = replace(
                primary_sleeve,
                total_weight=primary_sleeve.total_weight * scale,
                fallback_component_id=operation.provenance.component_id,
                fallback_symbols=fallback_assets.symbols,
                source_sleeve_component_id=source_sleeve_component_id,
                local_total_weight=(
                    primary_sleeve.total_weight
                    if source_sleeve_component_id is not None
                    else None
                ),
                source_allocation=(
                    scale if source_sleeve_component_id is not None else None
                ),
            )
            sleeves[lowered.id] = lowered
            return _LoweredTargets(sleeves=(lowered,))
        if isinstance(operation, ObserveTargetExitsOp):
            lowered = lower_targets(
                operation.targets,
                scale=scale,
                source_sleeve_component_id=source_sleeve_component_id,
            )
            if operation.last_exit_state not in cooldown_states:
                raise LeanLoweringError("target-exit observer references an unknown cooldown state")
            return replace(
                lowered,
                exit_state_ids=lowered.exit_state_ids + (operation.last_exit_state,),
            )
        raise LeanLoweringError(
            "Rebalance targets must lower from equal-weight, fallback, scaling, or merging"
        )

    def lower_snapshot(operation: RetainTargetsOp) -> LeanTargetSnapshot:
        existing = snapshots.get(operation.id)
        if existing is not None:
            return existing
        lowered = lower_targets(operation.targets)
        if lowered.snapshot_allocations:
            raise LeanLoweringError("retained targets cannot depend on another retained snapshot")
        snapshot = LeanTargetSnapshot(
            id=operation.id,
            sleeve_ids=tuple(item.id for item in lowered.sleeves),
            source_sleeve_component_id=operation.provenance.component_id,
        )
        snapshots[snapshot.id] = snapshot
        return snapshot

    rebalances: dict[str, LeanRebalance] = {}
    monthly_events: list[LeanMonthlyEvent] = []
    quarterly_events: list[LeanQuarterlyEvent] = []
    daily_events: list[LeanDailyEvent] = []
    required_symbols = requirements.assets
    if not required_symbols:
        raise LeanLoweringError("LEAN backend requires at least one asset subscription")

    event_actions: dict[str, dict[str, list[str]]] = {}
    for entrypoint in strategy_ir.entrypoints:
        event = operations.get(entrypoint.event)
        target = operations.get(entrypoint.target)
        if not isinstance(event, (DailyScheduleOp, MonthlyScheduleOp, QuarterlyScheduleOp)):
            raise LeanLoweringError("LEAN compiler v0 supports daily, monthly, and quarterly events")
        if not isinstance(event, DailyScheduleOp) and event.day != 1:
            raise LeanLoweringError(
                "LEAN compiler v0 supports only the first trading day of a period"
            )
        actions = event_actions.setdefault(event.id, {"refresh": [], "rebalance": []})
        if isinstance(target, RetainTargetsOp):
            lower_snapshot(target)
            actions["refresh"].append(target.id)
        elif isinstance(target, RebalanceOp):
            lowered = lower_targets(target.targets)
            total_weight = sum(
                (sleeve.total_weight for sleeve in lowered.sleeves), Decimal(0)
            ) + sum(
                (item.factor for item in lowered.snapshot_allocations), Decimal(0)
            )
            if total_weight != Decimal(1):
                raise LeanLoweringError("target sleeve weights must sum to 1")
            rebalances[target.id] = LeanRebalance(
                id=target.id,
                sleeve_ids=tuple(sleeve.id for sleeve in lowered.sleeves),
                snapshot_allocations=lowered.snapshot_allocations,
                exit_state_ids=tuple(sorted(set(lowered.exit_state_ids))),
            )
            actions["rebalance"].append(target.id)
        else:
            raise LeanLoweringError("scheduled target must refresh targets or rebalance")

    for event_id, actions in event_actions.items():
        event = operations[event_id]
        common = {
            "id": event.id,
            "anchor_symbol": required_symbols[0],
            "refresh_ids": tuple(sorted(set(actions["refresh"]))),
            "rebalance_ids": tuple(sorted(set(actions["rebalance"]))),
            "execution": LeanOnDataExecution(required_symbols=required_symbols),
        }
        if isinstance(event, DailyScheduleOp):
            daily_events.append(LeanDailyEvent(**common))
        elif isinstance(event, MonthlyScheduleOp):
            monthly_events.append(LeanMonthlyEvent(day=event.day, **common))
        else:
            quarterly_events.append(LeanQuarterlyEvent(day=event.day, **common))

    return normalize_lean_plan(
        LeanPlan(
            strategy_identity=strategy_ir.strategy_identity,
            subscriptions=tuple(LeanSubscription(symbol=symbol) for symbol in required_symbols),
            random_selections=tuple(selections.values()),
            target_sleeves=tuple(sleeves.values()),
            rebalances=tuple(rebalances.values()),
            monthly_events=tuple(monthly_events),
            momentum_selections=tuple(momentum_selections.values()),
            target_snapshots=tuple(snapshots.values()),
            quarterly_events=tuple(quarterly_events),
            daily_events=tuple(daily_events),
            cooldown_states=tuple(cooldown_states.values()),
        )
    )
