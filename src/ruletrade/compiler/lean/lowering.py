from __future__ import annotations

from decimal import Decimal

from ruletrade.compiler.analysis import StrategyRequirements
from ruletrade.compiler.lean.plan import (
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
    MergeTargetsOp,
    MonthlyScheduleOp,
    RandomNOp,
    RebalanceOp,
    StrategyIR,
)


class LeanLoweringError(ValueError):
    pass


def lower_strategy_ir_to_lean_plan(
    strategy_ir: StrategyIR,
    requirements: StrategyRequirements,
) -> LeanPlan:
    """Lower backend-independent Strategy IR into the LEAN-specific backend IR."""

    operations = {operation.id: operation for operation in strategy_ir.operations}
    selections: dict[str, LeanRandomSelection] = {}
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
        merge = operations.get(target.targets)
        if not isinstance(merge, MergeTargetsOp):
            raise LeanLoweringError("Rebalance input must be MergeTargets")
        left = lower_sleeve(merge.left)
        right = lower_sleeve(merge.right)
        if left.total_weight + right.total_weight != Decimal(1):
            raise LeanLoweringError("merged target sleeve weights must sum to 1")
        rebalances[target.id] = LeanRebalance(
            id=target.id,
            sleeve_ids=(left.id, right.id),
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
        )
    )
