from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from ruletrade.compiler.analysis import StrategyRequirements
from ruletrade.compiler.lean.plan import (
    LeanMomentumSelection,
    LeanMonthlyEvent,
    LeanOnDataExecution,
    LeanPlan,
    LeanRandomSelection,
    LeanRebalance,
    LeanSubscription,
    LeanTargetSleeve,
    normalize_lean_plan,
)
from ruletrade.ir.strategy import (
    AssetSetOp,
    EqualWeightOp,
    FilterOp,
    FirstNonEmptyTargetsOp,
    MergeTargetsOp,
    MonthlyScheduleOp,
    RandomNOp,
    RankOp,
    RebalanceOp,
    ScaleTargetsOp,
    StrategyIR,
    TopNOp,
    TrailingReturnOp,
)


class LeanLoweringError(ValueError):
    pass


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
    sleeves: dict[str, LeanTargetSleeve] = {}

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
            rank = operations.get(upstream.ranked)
            rank_input = operations.get(rank.scores) if isinstance(rank, RankOp) else None
            filter_operation = rank_input if isinstance(rank_input, FilterOp) else None
            score = (
                operations.get(filter_operation.scores)
                if filter_operation is not None
                else rank_input
            )
            asset_set = operations.get(score.assets) if isinstance(score, TrailingReturnOp) else None
            if not isinstance(rank, RankOp) or not isinstance(score, TrailingReturnOp) or not isinstance(asset_set, AssetSetOp):
                raise LeanLoweringError("Top N must consume ranked trailing returns over an asset set")
            symbols = asset_set.symbols
            selection_id = upstream.id
            history = history_requirements.get(score.provenance.component_id)
            if history is None:
                raise LeanLoweringError("trailing return history requirement is missing")
            momentum_selections[selection_id] = LeanMomentumSelection(
                id=selection_id,
                score_component_id=score.provenance.component_id,
                rank_component_id=rank.provenance.component_id,
                symbols=symbols,
                lookback_bars=history.lookback_bars,
                count=upstream.count,
                direction=rank.direction,
                price_field=history.price_field,
                filter_component_id=(
                    filter_operation.provenance.component_id
                    if filter_operation is not None
                    else None
                ),
                filter_operator=(
                    filter_operation.operator if filter_operation is not None else None
                ),
                filter_threshold=(
                    filter_operation.threshold if filter_operation is not None else None
                ),
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
    ) -> tuple[LeanTargetSleeve, ...]:
        operation = operations.get(operation_id)
        if isinstance(operation, MergeTargetsOp):
            return lower_targets(
                operation.left,
                scale=scale,
                source_sleeve_component_id=source_sleeve_component_id,
            ) + lower_targets(
                operation.right,
                scale=scale,
                source_sleeve_component_id=source_sleeve_component_id,
            )
        if isinstance(operation, ScaleTargetsOp):
            if source_sleeve_component_id is not None:
                raise LeanLoweringError("nested portfolio sleeves are not supported")
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
            return (lowered,)
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
            return (lowered,)
        raise LeanLoweringError(
            "Rebalance targets must lower from equal-weight, fallback, scaling, or merging"
        )

    rebalances: dict[str, LeanRebalance] = {}
    monthly_events: list[LeanMonthlyEvent] = []
    required_symbols = requirements.assets
    if not required_symbols:
        raise LeanLoweringError("LEAN backend requires at least one asset subscription")

    for entrypoint in strategy_ir.entrypoints:
        event = operations.get(entrypoint.event)
        target = operations.get(entrypoint.target)
        if not isinstance(event, MonthlyScheduleOp):
            raise LeanLoweringError("LEAN compiler v0 supports only monthly events")
        if event.day != 1:
            raise LeanLoweringError(
                "LEAN compiler v0 supports only the first trading day of the month"
            )
        if not isinstance(target, RebalanceOp):
            raise LeanLoweringError("monthly entrypoint must target Rebalance")
        lowered_sleeves = lower_targets(target.targets)
        if sum((sleeve.total_weight for sleeve in lowered_sleeves), Decimal(0)) != Decimal(1):
            raise LeanLoweringError("target sleeve weights must sum to 1")
        rebalances[target.id] = LeanRebalance(
            id=target.id,
            sleeve_ids=tuple(sleeve.id for sleeve in lowered_sleeves),
        )
        monthly_events.append(
            LeanMonthlyEvent(
                id=event.id,
                day=event.day,
                anchor_symbol=required_symbols[0],
                rebalance_ids=(target.id,),
                execution=LeanOnDataExecution(required_symbols=required_symbols),
            )
        )

    return normalize_lean_plan(
        LeanPlan(
            strategy_identity=strategy_ir.strategy_identity,
            subscriptions=tuple(LeanSubscription(symbol=symbol) for symbol in required_symbols),
            random_selections=tuple(selections.values()),
            target_sleeves=tuple(sleeves.values()),
            rebalances=tuple(rebalances.values()),
            monthly_events=tuple(monthly_events),
            momentum_selections=tuple(momentum_selections.values()),
        )
    )
