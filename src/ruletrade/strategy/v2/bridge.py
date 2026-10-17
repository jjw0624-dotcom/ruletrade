"""Narrow, explicit v2 -> maintained v1 compiler bridge.

This is intentionally not a silent migration.  It only lowers the demonstrated
daily static-Universe Selection subset after v2 semantic validation succeeds.
"""
from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.compiler.lean.plan import (
    LeanDailyEvent, LeanComparison, LeanMomentumSelection, LeanMonthlyEvent,
    LeanOnDataExecution, LeanPlan, LeanRebalance, LeanScoreTerm, LeanSubscription,
    LeanTargetSleeve, LeanTemporalAction,
    LeanTemporalAllocationLeg,
    LeanTemporalCondition, LeanTemporalEvent, LeanTemporalPolicyTarget,
    LeanTemporalProgram, LeanTemporalValue, LeanValue, normalize_lean_plan,
)
from ruletrade.strategy.v1.models import (
    AssetSetDefinition,
    ArithmeticExpression,
    BooleanExpression,
    CandidateExpression,
    CanonicalStrategyV1,
    ComparisonExpression,
    Component,
    Connection,
    Entrypoint,
    GroupDefinition,
    IndicatorExpression,
    LiteralExpression,
    NotExpression,
    PortReference,
    RollingAggregateExpression,
    StrategyDefinitions,
    StrategyGraph,
    UniverseDefinition,
)
from ruletrade.strategy.v1.validation import validate_strategy_v1
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    CandidateCurrentPriceValue,
    CandidateTrailingReturnValue,
    ClockedValueV2,
    CanonicalStrategyV2,
    BooleanGroupV2,
    BarsSinceEventValueV2,
    ComparisonV2,
    ConditionalStatementV2,
    ConditionV2,
    EventStatementV2,
    EventWindowConditionV2,
    GuardedAllocationStatementV2,
    LiteralValue,
    RememberedValueV2,
    RememberValueStatementV2,
    NotConditionV2,
    ProgramStatementV2,
    ScoreValueV2,
    SelectionStatementV2,
    StateConditionV2,
    StateTransitionStatementV2,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind
from ruletrade.strategy.v2.semantic_types import semantic_content_hash
from ruletrade.strategy.v2.validation import validate_strategy_v2


class V2LoweringError(ValueError):
    pass


def _temporal_value(value: ValueExpressionV2) -> LeanTemporalValue:
    if isinstance(value, ClockedValueV2) and (
        isinstance(value.source, DailyValueNode)
        and value.source.kind == "observe"
        and value.source.subject_kind == SubjectKind.ASSET
        and value.source.field == MarketField.CLOSE
        and value.source.basis == PriceBasis.ADJUSTED
        and value.source.subject_id
    ):
        return LeanTemporalValue(
            kind="completed_weekly_price", semantic_id=value.semantic_id,
            asset=value.source.subject_id, clock_id=value.clock_id,
        )
    if isinstance(value, DailyValueNode) and (
        value.kind == "observe"
        and value.subject_kind == SubjectKind.ASSET
        and value.field == MarketField.CLOSE
        and value.basis == PriceBasis.ADJUSTED
        and value.subject_id
    ):
        return LeanTemporalValue(
            kind="current_price", semantic_id=value.semantic_id, asset=value.subject_id,
        )
    if isinstance(value, LiteralValue):
        return LeanTemporalValue(
            kind="literal", semantic_id=value.semantic_id, literal=value.value,
        )
    if isinstance(value, RememberedValueV2):
        return LeanTemporalValue(
            kind="remembered", semantic_id=value.semantic_id, memory_id=value.memory_id,
        )
    if isinstance(value, BarsSinceEventValueV2):
        return LeanTemporalValue(
            kind="bars_since_event", semantic_id=value.semantic_id, event_id=value.event_id,
        )
    raise V2LoweringError(
        f"temporal profile cannot lower Value {getattr(value, 'kind', type(value).__name__)!r}"
    )


def _temporal_condition(condition: ConditionV2) -> LeanTemporalCondition:
    state: StateConditionV2 | None = None
    window: EventWindowConditionV2 | None = None
    comparison: ComparisonV2 | None = None
    children = condition.children if isinstance(condition, BooleanGroupV2) and condition.kind == "all" else (condition,)
    for child in children:
        if isinstance(child, StateConditionV2) and state is None:
            state = child
        elif isinstance(child, EventWindowConditionV2) and window is None:
            window = child
        elif isinstance(child, ComparisonV2) and comparison is None:
            comparison = child
        else:
            raise V2LoweringError(
                "temporal event profile requires at most one State guard, one Event window, and one Comparison"
            )
    if comparison is None:
        raise V2LoweringError("temporal event profile requires one typed Comparison")
    if window is not None and window.relation != "within":
        raise V2LoweringError("temporal LEAN profile currently lowers only within Event windows")
    return LeanTemporalCondition(
        semantic_id=condition.semantic_id,
        operator=comparison.operator,
        left=_temporal_value(comparison.left),
        right=_temporal_value(comparison.right),
        required_state_key=None if state is None else state.state_key,
        required_state_value=None if state is None else state.expected,
        after_event_id=None if window is None else window.event_id,
        within_observations=None if window is None else window.observations,
    )


def _temporal_action(statement: ProgramStatementV2) -> LeanTemporalAction:
    if isinstance(statement, RememberValueStatementV2):
        return LeanTemporalAction(
            kind="remember", semantic_id=statement.semantic_id,
            memory_id=statement.memory_id, value=_temporal_value(statement.value),
        )
    if isinstance(statement, StateTransitionStatementV2):
        transition = statement.transition
        if not isinstance(transition.when, StateConditionV2):
            raise V2LoweringError("temporal transition action requires a State equality guard")
        if (
            transition.when.state_key != transition.state_key
            or transition.when.expected != transition.from_value
        ):
            raise V2LoweringError("temporal transition State guard must match from_value")
        return LeanTemporalAction(
            kind="transition", semantic_id=statement.semantic_id,
            state_key=transition.state_key, from_value=transition.from_value,
            to_value=transition.to_value,
        )
    raise V2LoweringError(f"unsupported temporal Event action: {statement.kind}")


def _fixed_policy_target(allocation: AllocationStatementV2, *, semantic_id: str, state_key: str, state_value: str) -> LeanTemporalPolicyTarget:
    if allocation.method != "fixed" or len(allocation.legs) != 1 or allocation.legs[0].weight != Decimal(1):
        raise V2LoweringError("temporal policy requires a single fixed 100% target")
    target = allocation.legs[0].target
    if target.kind not in {"asset", "cash", "retain"}:
        raise V2LoweringError("temporal policy target must be asset, cash, or retain")
    return LeanTemporalPolicyTarget(
        semantic_id=semantic_id, state_key=state_key, state_value=state_value,
        target_kind=target.kind, asset=target.ref, weight=Decimal(1),
    )


def _composable_policy_target(
    allocation: AllocationStatementV2, *, semantic_id: str,
    state_key: str, state_value: str, selection_outputs: dict[str, str],
) -> LeanTemporalPolicyTarget:
    """Lower policy output without coupling Event/State to a concrete asset."""

    if allocation.method not in {"equal", "fixed", "proportional_score"}:
        raise V2LoweringError(f"composable policy cannot lower {allocation.method!r} allocation")
    legs: list[LeanTemporalAllocationLeg] = []
    for leg in allocation.legs:
        target = leg.target
        if target.kind == "selection":
            selection_id = selection_outputs.get(target.ref or "")
            if selection_id is None:
                raise V2LoweringError(f"policy references unknown Selection output {target.ref!r}")
            ref = selection_id
        elif target.kind in {"asset", "cash", "retain"}:
            ref = target.ref
        else:
            raise V2LoweringError("composable policy supports asset, Selection, cash, and retain targets")
        legs.append(LeanTemporalAllocationLeg(
            semantic_id=leg.semantic_id, target_kind=target.kind,
            target_ref=ref, weight=leg.weight,
        ))
    return LeanTemporalPolicyTarget(
        semantic_id=semantic_id, state_key=state_key, state_value=state_value,
        target_kind="portfolio", allocation_method=allocation.method, legs=tuple(legs),
    )


def _compile_temporal_program(strategy: CanonicalStrategyV2) -> LeanPlan | None:
    if strategy.program is None:
        return None
    top = strategy.program.statements
    events = tuple(item for item in top if isinstance(item, EventStatementV2))
    selections = tuple(item for item in top if isinstance(item, SelectionStatementV2))
    policies = tuple(item for item in top if isinstance(item, GuardedAllocationStatementV2))
    if not events and not policies:
        return None
    if len(policies) != 1 or len(events) + len(selections) + 1 != len(top):
        raise V2LoweringError(
            "temporal execution requires Selections, ordered Events, and one guarded policy"
        )
    clocks = {item.id: item for item in strategy.program.clocks}
    lowered_events: list[LeanTemporalEvent] = []
    symbols: set[str] = set()
    for statement in events:
        event = statement.event
        clock = clocks.get(event.clock_id)
        if clock is None or clock.timeframe != "daily" or clock.boundary != "close":
            raise V2LoweringError("event-state-daily@1 requires a completed daily close clock")
        if event.trigger not in {"rising_edge", "while_true", "crosses_above", "crosses_below"}:
            raise V2LoweringError(f"unsupported temporal Event trigger: {event.trigger}")
        if event.occurrence not in {"every", "first"}:
            raise V2LoweringError(f"unsupported temporal Event occurrence: {event.occurrence}")
        condition = _temporal_condition(event.condition)
        for value in (condition.left, condition.right):
            if value.kind in {"current_price", "completed_weekly_price"} and value.asset:
                symbols.add(value.asset)
            if value.kind == "completed_weekly_price":
                weekly = clocks.get(value.clock_id or "")
                if weekly is None or weekly.timeframe != "weekly" or weekly.boundary != "close":
                    raise V2LoweringError(
                        "multi-clock temporal profile requires a completed weekly close clock"
                    )
                if weekly.timezone != clock.timezone or weekly.timezone != "America/New_York":
                    raise V2LoweringError(
                        "multi-clock temporal profile requires aligned America/New_York clocks"
                    )
        lowered_events.append(LeanTemporalEvent(
            semantic_id=event.semantic_id, statement_id=statement.semantic_id,
            clock_id=event.clock_id, trigger=event.trigger,
            occurrence=event.occurrence, condition=condition,
            actions=tuple(_temporal_action(item) for item in statement.statements),
        ))
    policy = policies[0]
    if policy.guard is not None or policy.fallback is not None or not policy.overrides:
        raise V2LoweringError(
            "temporal policy requires State overrides and a primary target"
        )
    selection_outputs = {item.output_id: item.selection.semantic_id for item in selections}
    state_key: str | None = None
    lowered_targets: list[LeanTemporalPolicyTarget] = []
    for override in sorted(policy.overrides, key=lambda item: item.priority, reverse=True):
        if not isinstance(override.when, StateConditionV2):
            raise V2LoweringError("temporal policy override requires a State equality condition")
        state_key = state_key or override.when.state_key
        if override.when.state_key != state_key:
            raise V2LoweringError("composable temporal policy requires one explicit State axis")
        lower = _composable_policy_target if selections else _fixed_policy_target
        lowered_targets.append(lower(
            override.action, semantic_id=override.semantic_id,
            state_key=override.when.state_key, state_value=override.when.expected,
            **({"selection_outputs": selection_outputs} if selections else {}),
        ))
    assert state_key is not None
    lower = _composable_policy_target if selections else _fixed_policy_target
    lowered_targets.append(lower(
        policy.primary, semantic_id=policy.primary.semantic_id,
        state_key=state_key, state_value="*",
        **({"selection_outputs": selection_outputs} if selections else {}),
    ))
    policy_targets = tuple(lowered_targets)
    for target in policy_targets:
        if target.asset:
            symbols.add(target.asset)
        for leg in target.legs:
            if leg.target_kind == "asset" and leg.target_ref:
                symbols.add(leg.target_ref)
    for selection in selections:
        if selection.selection.fallback_asset:
            symbols.add(selection.selection.fallback_asset)
    if not symbols:
        for selection in selections:
            group = next((item for item in strategy.definitions.groups if item.id == selection.selection.universe_id), None)
            asset_set = next((item for item in strategy.definitions.asset_sets if group and item.id == group.asset_set_ref), None)
            if asset_set:
                symbols.update(asset_set.assets)
    if not symbols:
        raise V2LoweringError("event-state-daily@1 currently requires one adjusted-close asset")
    anchor = next((value.asset for event in lowered_events for value in (event.condition.left, event.condition.right) if value.asset), sorted(symbols)[0])
    selection_plans: list[LeanPlan] = []
    compiled_selection_ids: dict[str, str] = {}
    for selection in selections:
        referenced = [
            target for target in policy_targets for leg in target.legs
            if leg.target_kind == "selection" and leg.target_ref == selection.selection.semantic_id
        ]
        method = "proportional_score" if referenced and referenced[0].allocation_method == "proportional_score" else "equal"
        isolated_allocation = AllocationStatementV2(
            semantic_id=f"{selection.semantic_id}-execution-allocation", method=method,
            clock_id=selection.clock_id,
            legs=(policy.primary.legs[0].model_copy(update={
                "semantic_id": f"{selection.semantic_id}-execution-leg",
                "target": policy.primary.legs[0].target.model_copy(update={
                    "semantic_id": f"{selection.semantic_id}-execution-target",
                    "kind": "selection", "ref": selection.output_id,
                }), "weight": None,
            }),),
        )
        topology_selection = selection.model_copy(update={
            "selection": selection.selection.model_copy(update={"fallback_asset": None}),
        })
        isolated = strategy.model_copy(update={
            "program": strategy.program.model_copy(update={"statements": (topology_selection, isolated_allocation)}),
        })
        selection_plan = compile_v2_strategy_to_lean_plan(isolated)
        if len(selection_plan.momentum_selections) != 1:
            raise V2LoweringError("composable Selection must lower to one typed ranking node")
        original_selection_id = selection_plan.momentum_selections[0].id
        compiled_selection_id = selection.selection.semantic_id
        selection_plan = replace(
            selection_plan,
            momentum_selections=(replace(
                selection_plan.momentum_selections[0], id=compiled_selection_id,
            ),),
            target_sleeves=tuple(replace(
                sleeve, id=f"{compiled_selection_id}-sleeve",
                selection_id=compiled_selection_id,
            ) if sleeve.selection_id == original_selection_id else sleeve
            for sleeve in selection_plan.target_sleeves),
        )
        compiled_selection_ids[selection.selection.semantic_id] = compiled_selection_id
        if selection.selection.fallback_asset:
            selection_plan = replace(selection_plan, target_sleeves=tuple(
                replace(
                    sleeve, fallback_component_id=f"{selection.semantic_id}-fallback",
                    fallback_symbols=(selection.selection.fallback_asset,),
                ) if sleeve.selection_id == compiled_selection_id else sleeve
                for sleeve in selection_plan.target_sleeves
            ))
        selection_plans.append(selection_plan)
    policy_targets = tuple(replace(
        target,
        legs=tuple(replace(
            leg, target_ref=compiled_selection_ids.get(leg.target_ref or "", leg.target_ref),
        ) for leg in target.legs),
    ) for target in policy_targets)
    subscriptions = {symbol: LeanSubscription(symbol) for symbol in symbols}
    momentum = []
    sleeves = []
    for selection_plan in selection_plans:
        subscriptions.update({item.symbol: item for item in selection_plan.subscriptions})
        momentum.extend(selection_plan.momentum_selections)
        sleeves.extend(selection_plan.target_sleeves)
    return normalize_lean_plan(LeanPlan(
        strategy_identity=semantic_content_hash(strategy.model_dump(mode="json")),
        subscriptions=tuple(subscriptions.values()), random_selections=(),
        target_sleeves=tuple(sleeves), rebalances=(), monthly_events=(),
        momentum_selections=tuple(momentum),
        temporal_program=LeanTemporalProgram(
            profile=(
                "composable-semantic-execution@1" if selections else
                "event-state-multiclock@1"
                if any(
                    value.kind == "completed_weekly_price"
                    for item in lowered_events
                    for value in (item.condition.left, item.condition.right)
                )
                else "event-state-daily@1"
            ),
            semantic_id=strategy.program.semantic_id,
            checkpoint_identity=semantic_content_hash({
                "program": strategy.program.model_dump(mode="json"),
                "operator_lock": strategy.operator_lock,
                "execution_profile": (
                    "event-state-multiclock@1"
                    if any(
                        value.kind == "completed_weekly_price"
                        for item in lowered_events
                        for value in (item.condition.left, item.condition.right)
                    )
                    else "event-state-daily@1"
                ),
            }),
            operator_versions=tuple(sorted(strategy.operator_lock.items())),
            clock_id=(
                lowered_events[0].clock_id if lowered_events else
                selections[0].clock_id or strategy.program.clocks[0].id
            ), anchor_symbol=anchor,
            initial_state=tuple(sorted(strategy.program.initial_state.items())),
            events=tuple(lowered_events), policy_statement_id=policy.semantic_id,
            policy_targets=policy_targets, asset_universe=tuple(sorted(subscriptions)),
        ),
    ))


def _program_statements(items: tuple[ProgramStatementV2, ...]) -> tuple[ProgramStatementV2, ...]:
    result: list[ProgramStatementV2] = []
    for item in items:
        result.append(item)
        if item.kind == "control":
            result.extend(_program_statements(item.then_statements))
            result.extend(_program_statements(item.otherwise_statements))
        elif item.kind == "on_event":
            result.extend(_program_statements(item.statements))
    return tuple(result)


def _program_selection(
    strategy: CanonicalStrategyV2,
) -> tuple[SelectionStatementV2, AllocationStatementV2, str]:
    if strategy.program is None:
        raise V2LoweringError("Program-native lowering requires a Semantic Program")
    statements = _program_statements(strategy.program.statements)
    unsupported = tuple(item for item in statements if item.kind in {
        "control", "on_event", "transition", "remember_value", "guarded_allocation", "unresolved",
    })
    if unsupported:
        raise V2LoweringError(
            f"Program statement {unsupported[0].kind!r} is reference-valid but has no maintained LEAN lowering"
        )
    selections = tuple(item for item in statements if isinstance(item, SelectionStatementV2))
    if len(selections) != 1:
        raise V2LoweringError("production Program lowering currently requires exactly one Selection")
    selection = selections[0]
    allocations = tuple(item for item in statements if isinstance(item, AllocationStatementV2) and any(
        leg.target.kind == "selection" and leg.target.ref == selection.output_id for leg in item.legs
    ))
    if len(allocations) != 1 or allocations[0].method not in {"equal", "proportional_score"}:
        raise V2LoweringError(
            "production Program lowering requires one supported Selection allocation"
        )
    allocation = allocations[0]
    if allocation.minimum_weight is not None or allocation.maximum_weight is not None or allocation.cash_remainder_asset is not None:
        raise V2LoweringError("bounded Selection allocation has no maintained LEAN lowering")
    clock_id = selection.clock_id or allocations[0].clock_id
    clock = next((item for item in strategy.program.clocks if item.id == clock_id), strategy.program.clocks[0])
    if clock.timeframe not in {"daily", "monthly"}:
        raise V2LoweringError(f"{clock.timeframe} Program timing has no maintained LEAN lowering")
    return selection, allocation, clock.timeframe


def _program_split(strategy: CanonicalStrategyV2) -> AllocationStatementV2 | None:
    if strategy.program is None:
        return None
    splits = tuple(
        item for item in _program_statements(strategy.program.statements)
        if isinstance(item, AllocationStatementV2)
        and item.method == "fixed"
        and len(item.legs) == 2
        and all(leg.target.kind == "group" for leg in item.legs)
    )
    if len(splits) > 1:
        raise V2LoweringError("production Program lowering supports one Portfolio Split")
    return splits[0] if splits else None


def _port(component_id: str, port: str) -> PortReference:
    return PortReference(component_id=component_id, port=port)


def _daily_value(expression: DailyValueNode):
    if expression.kind == "literal":
        value_type = {
            ("return", "ratio"): "percentage",
            ("price", "USD/share"): "money_per_share",
            ("oscillator", "points"): "decimal",
            ("score", "ratio"): "decimal",
        }.get((expression.quantity.value, expression.unit.value))
        if value_type is None:
            raise V2LoweringError("typed literal has no maintained v1 lowering")
        return LiteralExpression(value_type=value_type, value=expression.value)
    if expression.kind == "observe":
        if expression.subject_kind != SubjectKind.CANDIDATE or expression.field != MarketField.CLOSE or expression.basis != PriceBasis.ADJUSTED:
            raise V2LoweringError("maintained v1 bridge supports Candidate adjusted close only")
        from ruletrade.strategy.v1.models import CurrentExpression, MarketSeriesExpression
        return CurrentExpression(series=MarketSeriesExpression(field="price", subject=CandidateExpression()))
    if expression.kind == "trailing_return":
        return IndicatorExpression(
            indicator_id="trailing_return_indicator@1", asset=CandidateExpression(),
            parameters={"lookback_bars": expression.observations},
        )
    if expression.kind == "sma":
        from ruletrade.strategy.v1.models import MarketSeriesExpression
        return RollingAggregateExpression(
            operator="mean",
            series=MarketSeriesExpression(field="price", subject=CandidateExpression()),
            window_observations=expression.observations or 1,
        )
    if expression.kind == "arithmetic":
        return ArithmeticExpression(
            operator=expression.arithmetic,
            left=_daily_value(expression.operands[0]),
            right=_daily_value(expression.operands[1]),
        )
    raise V2LoweringError(f"DailyValue {expression.kind} executes through the v2 typed runtime, not the legacy bridge")


def _value(expression: ValueExpressionV2):
    if isinstance(expression, DailyValueNode):
        return _daily_value(expression)
    if isinstance(expression, CandidateTrailingReturnValue):
        return IndicatorExpression(
            indicator_id="trailing_return_indicator@1",
            asset=CandidateExpression(),
            parameters={"lookback_bars": expression.lookback_observations},
        )
    if isinstance(expression, CandidateCurrentPriceValue):
        from ruletrade.strategy.v1.models import CurrentExpression, MarketSeriesExpression
        return CurrentExpression(series=MarketSeriesExpression(field="price", subject=CandidateExpression()))
    if isinstance(expression, LiteralValue):
        value_type = {
            ("return", "ratio"): "percentage",
            ("price", "USD/share"): "money_per_share",
        }.get((expression.quantity.value, expression.unit.value))
        if value_type is None:
            raise V2LoweringError(
                f"v2 literal {expression.quantity}/{expression.unit} has no maintained v1 lowering"
            )
        return LiteralExpression(value_type=value_type, value=expression.value)
    raise V2LoweringError(f"unsupported v2 value: {type(expression)!r}")


def _ranking_lookback(expression: ValueExpressionV2) -> int:
    if isinstance(expression, DailyValueNode) and expression.kind == "trailing_return":
        return expression.observations or 1
    if isinstance(expression, CandidateTrailingReturnValue):
        return expression.lookback_observations
    return 1


def _condition(value: ConditionV2):
    if isinstance(value, ComparisonV2):
        return ComparisonExpression(operator=value.operator, left=_value(value.left), right=_value(value.right))
    if isinstance(value, NotConditionV2):
        return NotExpression(operand=_condition(value.child))
    if isinstance(value, BooleanGroupV2):
        return BooleanExpression(
            operator="and" if value.kind == "all" else "or",
            operands=[_condition(child) for child in value.children],
        )
    raise V2LoweringError(f"Condition {value.kind} is reference-valid but has no maintained LEAN lowering")


def lower_v2_to_v1(strategy: CanonicalStrategyV2) -> CanonicalStrategyV1:
    diagnostics = validate_strategy_v2(strategy)
    if diagnostics:
        rendered = "; ".join(f"{item.path}: {item.code}" for item in diagnostics)
        raise V2LoweringError(f"v2 semantic validation failed: {rendered}")

    program_timeframe = "daily"
    selection = strategy.selection
    if selection is None:
        statement, allocation, program_timeframe = _program_selection(strategy)
        if allocation.method != "equal":
            raise V2LoweringError(
                "legacy v1 conversion cannot represent score-proportional allocation"
            )
        selection = statement.selection
    universe = next((item for item in strategy.definitions.groups if item.id == selection.universe_id), None)
    if universe is None:
        raise V2LoweringError("Profile A bridge currently requires a Group-backed static Universe")

    components = [
        Component(id="event", primitive="monthly@1" if program_timeframe == "monthly" else "daily@1", config={"day": 1} if program_timeframe == "monthly" else {}),
        Component(id="universe", primitive="universe@1", config={"universe_ref": "candidates"}),
        Component(id="score", primitive="trailing_return@1", config={
            "lookback_bars": _ranking_lookback(selection.ranking),
        }),
        Component(
            id="eligible",
            primitive="filter@1",
            config={"operator": "gt", "threshold": Decimal(0)},
            condition=_condition(selection.eligibility) if selection.eligibility else None,
        ),
        Component(
            id="rank",
            primitive="rank@1",
            config={"direction": selection.direction},
            value_expression=_value(selection.ranking),
        ),
        Component(
            id="take",
            primitive="top_n@1",
            config={"count": selection.count, "shortage_policy": selection.shortage_policy},
        ),
        Component(id="weights", primitive="equal_weight@1", config={"total": Decimal(1)}),
        Component(id="rebalance", primitive="rebalance@1"),
    ]
    connections = [
        Connection(source=_port("universe", "assets"), target=_port("score", "assets")),
        Connection(source=_port("score", "scores"), target=_port("eligible", "scores")),
        Connection(source=_port("eligible", "scores"), target=_port("rank", "scores")),
        Connection(source=_port("rank", "ranked"), target=_port("take", "ranked")),
        Connection(source=_port("take", "selected"), target=_port("weights", "assets")),
    ]
    asset_sets = [
        AssetSetDefinition(id=item.id, assets=list(item.assets))
        for item in strategy.definitions.asset_sets
        if item.assets
    ]
    target_component = "weights"
    if selection.fallback_asset:
        fallback_set_id = "v2-fallback-assets"
        asset_sets.append(AssetSetDefinition(id=fallback_set_id, assets=[selection.fallback_asset]))
        components.append(Component(id="fallback", primitive="fallback@1", config={"fallback_asset_set_ref": fallback_set_id}))
        connections.append(Connection(source=_port("weights", "targets"), target=_port("fallback", "primary")))
        target_component = "fallback"
    connections.append(Connection(source=_port(target_component, "targets"), target=_port("rebalance", "targets")))
    v1 = CanonicalStrategyV1(
        metadata=strategy.metadata,
        definitions=StrategyDefinitions(
            asset_sets=asset_sets,
            groups=strategy.definitions.groups,
            universes=(UniverseDefinition(
                id="candidates", name="v2 candidates", source="group", group_ref=universe.id,
            ),),
        ),
        graph=StrategyGraph(
            components=components,
            connections=connections,
        ),
        entrypoints=(Entrypoint(event_component_id="event", target_component_id="rebalance"),),
    )
    split = _program_split(strategy)
    if split is not None:
        selected_group = selection.universe_id
        split_groups = [leg.target.ref for leg in split.legs]
        if selected_group not in split_groups:
            raise V2LoweringError("Portfolio Split does not target the Selection Investment")
        selected_target = "fallback" if selection.fallback_asset else "weights"
        expanded_components = list(v1.graph.components)
        expanded_connections = [
            item for item in v1.graph.connections
            if not (item.target.component_id == "rebalance" and item.target.port == "targets")
        ]
        sleeve_ids: list[str] = []
        for leg in split.legs:
            assert leg.target.ref is not None and leg.weight is not None
            group = next((item for item in strategy.definitions.groups if item.id == leg.target.ref), None)
            if group is None:
                raise V2LoweringError(f"Split Investment {leg.target.ref!r} does not exist")
            sleeve_id = f"v2-sleeve-{group.id}"
            sleeve_ids.append(sleeve_id)
            expanded_components.append(Component(
                id=sleeve_id, primitive="portfolio_sleeve@1",
                config={"name": group.name, "allocation": leg.weight},
            ))
            if group.id == selected_group:
                local_target = selected_target
            else:
                assets_id = f"v2-assets-{group.id}"
                weights_id = f"v2-weights-{group.id}"
                expanded_components.extend((
                    Component(id=assets_id, primitive="asset_set@1", config={"asset_set_ref": group.asset_set_ref}),
                    Component(id=weights_id, primitive="equal_weight@1", config={"total": Decimal(1)}),
                ))
                expanded_connections.append(Connection(source=_port(assets_id, "assets"), target=_port(weights_id, "assets")))
                local_target = weights_id
            expanded_connections.append(Connection(source=_port(local_target, "targets"), target=_port(sleeve_id, "local_targets")))
        expanded_components.append(Component(id="v2-portfolio", primitive="portfolio@1", config={"name": "Portfolio"}))
        expanded_connections.extend(
            Connection(source=_port(sleeve_id, "targets"), target=_port("v2-portfolio", "sleeves"))
            for sleeve_id in sleeve_ids
        )
        expanded_connections.append(Connection(source=_port("v2-portfolio", "targets"), target=_port("rebalance", "targets")))
        v1 = v1.model_copy(update={"graph": StrategyGraph(components=expanded_components, connections=expanded_connections)})
    validate_strategy_v1(v1)
    return v1


def _program_value(value: ValueExpressionV2) -> LeanValue:
    """Lower scalar Program Values without routing through the legacy graph."""
    if isinstance(value, DailyValueNode):
        if value.kind == "literal":
            value_type = {
                ("return", "ratio"): "percentage",
                ("price", "USD/share"): "money_per_share",
            }.get((value.quantity.value, value.unit.value), "decimal")
            return LeanValue(kind="literal", value_type=value_type, literal=value.value)
        subject = "candidate" if value.subject_kind == SubjectKind.CANDIDATE else "asset"
        asset = value.subject_id if subject == "asset" else None
        if value.kind == "observe" and value.field == MarketField.CLOSE and value.basis == PriceBasis.ADJUSTED:
            return LeanValue(kind="current_price", value_type="money_per_share", subject=subject, asset=asset)
        if value.kind == "trailing_return" and value.operands:
            source = value.operands[0]
            source_subject = "candidate" if source.subject_kind == SubjectKind.CANDIDATE else "asset"
            return LeanValue(
                kind="trailing_return", value_type="percentage", subject=source_subject,
                asset=source.subject_id if source_subject == "asset" else None,
                observations=value.observations,
            )
        if value.kind == "sma" and value.operands:
            source = value.operands[0]
            source_subject = "candidate" if source.subject_kind == SubjectKind.CANDIDATE else "asset"
            return LeanValue(
                kind="rolling_price", value_type="money_per_share", subject=source_subject,
                asset=source.subject_id if source_subject == "asset" else None,
                observations=value.observations, aggregate="mean",
            )
    if isinstance(value, CandidateTrailingReturnValue):
        return LeanValue(
            kind="trailing_return", value_type="percentage", subject="candidate",
            observations=value.lookback_observations,
        )
    if isinstance(value, CandidateCurrentPriceValue):
        return LeanValue(kind="current_price", value_type="money_per_share", subject="candidate")
    if isinstance(value, LiteralValue):
        value_type = {
            ("return", "ratio"): "percentage",
            ("price", "USD/share"): "money_per_share",
        }.get((value.quantity.value, value.unit.value), "decimal")
        return LeanValue(kind="literal", value_type=value_type, literal=value.value)
    if isinstance(value, ScoreValueV2):
        return _lean_score_value(value)
    raise V2LoweringError(f"Program Value {getattr(value, 'kind', type(value).__name__)!r} has no maintained LEAN lowering")


def _program_comparisons(condition: ConditionV2) -> tuple[LeanComparison, ...]:
    if isinstance(condition, ComparisonV2):
        return (LeanComparison(
            operator=condition.operator,
            left=_program_value(condition.left), right=_program_value(condition.right),
        ),)
    if isinstance(condition, BooleanGroupV2) and condition.kind == "all":
        return tuple(
            comparison
            for child in condition.children
            for comparison in _program_comparisons(child)
        )
    raise V2LoweringError(
        f"Program Condition {condition.kind!r} is valid but has no maintained conditional LEAN lowering"
    )


def _compile_static_program(strategy: CanonicalStrategyV2) -> LeanPlan | None:
    """Compile allocation-driven, non-temporal Program semantics to the shared plan.

    This covers direct targets, selected Subgroups, fixed Portfolio splits and
    explicit IF/OTHERWISE routing.  It deliberately rejects rather than drops
    statements outside that bounded grammar.
    """
    if strategy.program is None:
        return None
    top_level = tuple(
        item for item in strategy.program.statements
        if not (
            isinstance(item, AllocationStatementV2)
            and item.semantic_id == "initial-retain-allocation"
            and len(item.legs) == 1 and item.legs[0].target.kind == "retain"
        )
    )
    if not top_level:
        return None
    allowed = (SelectionStatementV2, AllocationStatementV2, ConditionalStatementV2)
    if any(not isinstance(item, allowed) for item in top_level):
        return None

    flattened = _program_statements(top_level)
    if any(not isinstance(item, (SelectionStatementV2, AllocationStatementV2, ConditionalStatementV2)) for item in flattened):
        return None
    selection_statements = tuple(item for item in flattened if isinstance(item, SelectionStatementV2))
    selection_by_output = {item.output_id: item for item in selection_statements}
    if len(selection_by_output) != len(selection_statements):
        raise V2LoweringError("Program Selection outputs must be unique")

    groups = {item.id: item for item in strategy.definitions.groups}
    asset_sets = {item.id: tuple(item.assets) for item in strategy.definitions.asset_sets}
    selections: dict[str, LeanMomentumSelection] = {}
    symbols: set[str] = set()
    for statement in selection_statements:
        selection = statement.selection
        group = groups.get(selection.universe_id)
        universe = asset_sets.get(group.asset_set_ref, ()) if group is not None else ()
        if not universe:
            raise V2LoweringError(f"Selection {statement.semantic_id!r} requires a non-empty Group")
        ranking = _program_value(selection.ranking)
        eligibility = (
            _program_comparisons(selection.eligibility)
            if selection.eligibility is not None else ()
        )
        selections[selection.semantic_id] = LeanMomentumSelection(
            id=selection.semantic_id,
            score_component_id=f"{statement.semantic_id}-score",
            rank_component_id=f"{statement.semantic_id}-rank",
            selection_component_id=statement.semantic_id,
            symbols=universe,
            lookback_bars=max(1, _lean_value_observations(ranking) - 1),
            count=selection.count,
            direction=selection.direction,
            shortage_policy=selection.shortage_policy,
            ranking_value=ranking,
            eligibility=eligibility,
            filter_component_id=(f"{statement.semantic_id}-eligibility" if eligibility else None),
        )
        symbols.update(universe)
        if selection.fallback_asset:
            symbols.add(selection.fallback_asset)

    sleeves: dict[str, LeanTargetSleeve] = {}

    def allocation_sleeves(allocation: AllocationStatementV2) -> tuple[str, ...]:
        if allocation.minimum_weight is not None or allocation.maximum_weight is not None or allocation.cash_remainder_asset is not None:
            raise V2LoweringError("bounded Program allocation has no maintained LEAN lowering")
        if allocation.method not in {"equal", "fixed", "proportional_score"}:
            raise V2LoweringError(f"unsupported Program allocation: {allocation.method}")
        result: list[str] = []
        for leg in allocation.legs:
            target = leg.target
            selection_id: str | None = None
            fallback: tuple[str, ...] = ()
            if target.kind == "asset" and target.ref:
                local_symbols = (target.ref,)
            elif target.kind == "group" and target.ref:
                group = groups.get(target.ref)
                local_symbols = asset_sets.get(group.asset_set_ref, ()) if group is not None else ()
            elif target.kind == "selection" and target.ref:
                statement = selection_by_output.get(target.ref)
                if statement is None:
                    raise V2LoweringError(f"Investment references unknown Subgroup {target.ref!r}")
                selection_id = statement.selection.semantic_id
                local_symbols = selections[selection_id].symbols
                if statement.selection.fallback_asset:
                    fallback = (statement.selection.fallback_asset,)
            else:
                raise V2LoweringError(f"Program target {target.kind!r} has no maintained static lowering")
            if not local_symbols:
                raise V2LoweringError(f"Investment target {target.ref!r} has no assets")
            total = leg.weight if allocation.method == "fixed" else Decimal(1)
            assert total is not None
            sleeve = LeanTargetSleeve(
                id=leg.semantic_id,
                symbols=tuple(local_symbols), total_weight=total,
                selection_id=selection_id,
                fallback_component_id=(f"{statement.semantic_id}-fallback" if selection_id and fallback else None),
                fallback_symbols=fallback,
                source_sleeve_component_id=(leg.semantic_id if len(allocation.legs) > 1 else None),
                local_total_weight=(Decimal(1) if len(allocation.legs) > 1 else None),
                source_allocation=(total if len(allocation.legs) > 1 else None),
                weighting_method=("proportional_score" if allocation.method == "proportional_score" else "equal"),
                allocation_component_id=allocation.semantic_id,
            )
            sleeves[sleeve.id] = sleeve
            symbols.update(local_symbols)
            symbols.update(fallback)
            result.append(sleeve.id)
        total_weight = sum((sleeves[item].total_weight for item in result), Decimal(0))
        if total_weight != Decimal(1):
            raise V2LoweringError("Portfolio Investment weights must sum exactly to 1")
        return tuple(result)

    rebalances: list[LeanRebalance] = []
    clock_ids: list[str] = []
    allocations = tuple(item for item in top_level if isinstance(item, AllocationStatementV2))
    controls = tuple(item for item in top_level if isinstance(item, ConditionalStatementV2))
    if allocations and controls:
        raise V2LoweringError("top-level Allocation and conditional routing cannot be mixed")
    if len(allocations) > 1 or len(controls) > 1:
        raise V2LoweringError("static Program lowering requires one Portfolio routing statement")
    if allocations:
        allocation = allocations[0]
        rebalances.append(LeanRebalance(id=allocation.semantic_id, sleeve_ids=allocation_sleeves(allocation)))
        clock_ids.append(allocation.clock_id or strategy.program.clocks[0].id)
    elif controls:
        control = controls[0]
        then_allocations = tuple(item for item in control.then_statements if isinstance(item, AllocationStatementV2))
        otherwise_allocations = tuple(item for item in control.otherwise_statements if isinstance(item, AllocationStatementV2))
        if len(then_allocations) != 1 or len(otherwise_allocations) != 1:
            raise V2LoweringError("conditional Investment requires one Allocation in THEN and OTHERWISE")
        rebalances.append(LeanRebalance(
            id=control.semantic_id,
            sleeve_ids=allocation_sleeves(then_allocations[0]),
            condition=_program_comparisons(control.condition),
            condition_unknown_policy=control.unknown_policy,
            otherwise_sleeve_ids=allocation_sleeves(otherwise_allocations[0]),
        ))
        clock_ids.append(control.clock_id or strategy.program.clocks[0].id)
    else:
        return None

    referenced = {
        sleeves[sleeve_id].selection_id
        for rebalance in rebalances
        for sleeve_id in rebalance.sleeve_ids + rebalance.otherwise_sleeve_ids
        if sleeves[sleeve_id].selection_id is not None
    }
    declared = set(selections)
    if referenced != declared:
        missing = sorted(declared - referenced)
        raise V2LoweringError(f"Selection outputs have no Investment: {', '.join(missing)}")
    clocks = {item.id: item for item in strategy.program.clocks}
    selected_clocks = [clocks[item] for item in clock_ids]
    if len({(item.timeframe, item.boundary) for item in selected_clocks}) != 1:
        raise V2LoweringError("static Portfolio routing requires one shared execution clock")
    clock = selected_clocks[0]
    if clock.timeframe not in {"daily", "monthly"}:
        raise V2LoweringError(f"{clock.timeframe} Program timing has no maintained static LEAN lowering")
    if not symbols:
        raise V2LoweringError("static Program execution requires at least one asset")
    anchor = sorted(symbols)[0]
    execution = LeanOnDataExecution(required_symbols=tuple(sorted(symbols)))
    event_id = f"{clock.id}-event"
    event_kwargs = {
        "id": event_id, "anchor_symbol": anchor,
        "rebalance_ids": tuple(item.id for item in rebalances),
        "execution": execution,
    }
    return normalize_lean_plan(LeanPlan(
        strategy_identity=semantic_content_hash(strategy.model_dump(mode="json")),
        subscriptions=tuple(LeanSubscription(symbol=item) for item in sorted(symbols)),
        random_selections=(), target_sleeves=tuple(sleeves.values()),
        rebalances=tuple(rebalances),
        monthly_events=(LeanMonthlyEvent(day=1, **event_kwargs),) if clock.timeframe == "monthly" else (),
        daily_events=(LeanDailyEvent(**event_kwargs),) if clock.timeframe == "daily" else (),
        momentum_selections=tuple(selections.values()),
    ))


def compile_v2_strategy_to_lean_plan(strategy: CanonicalStrategyV2):
    """Lower the maintained Program subset to the typed LEAN plan.

    Equal-weight Selection retains the historical v1 topology bridge. Weighted
    Score plus score-proportional allocation reuses that proven topology, then
    replaces the placeholder ranking/allocation nodes with typed v2 plan values.
    The placeholder never escapes this function or becomes authoritative data.
    """

    diagnostics = validate_strategy_v2(strategy)
    if diagnostics:
        rendered = "; ".join(f"{item.path}: {item.code}" for item in diagnostics)
        raise V2LoweringError(f"v2 semantic validation failed: {rendered}")
    if strategy.selection is not None or strategy.program is None:
        return compile_strategy_to_lean_plan(lower_v2_to_v1(strategy))

    temporal_plan = _compile_temporal_program(strategy)
    if temporal_plan is not None:
        return temporal_plan

    static_plan = _compile_static_program(strategy)
    if static_plan is not None:
        return static_plan

    statement, allocation, _timeframe = _program_selection(strategy)
    if allocation.method == "equal":
        return compile_strategy_to_lean_plan(lower_v2_to_v1(strategy))
    if allocation.method != "proportional_score":
        raise V2LoweringError(f"unsupported Selection allocation: {allocation.method}")
    if statement.selection.fallback_asset is not None:
        raise V2LoweringError("score-proportional allocation does not support Selection fallback")
    if _program_split(strategy) is not None:
        raise V2LoweringError("score-proportional allocation does not support Portfolio Split")
    ranking = statement.selection.ranking
    if not isinstance(ranking, ScoreValueV2) or ranking.condition_terms:
        raise V2LoweringError(
            "score-proportional allocation requires a weighted Value Score without Condition terms"
        )
    ranking_value = _lean_score_value(ranking)
    seed = ranking.terms[0].value

    replacement_statements: list[ProgramStatementV2] = []
    for item in strategy.program.statements:
        if item.semantic_id == statement.semantic_id:
            replacement_statements.append(item.model_copy(update={
                "selection": item.selection.model_copy(update={"ranking": seed}),
            }))
        elif item.semantic_id == allocation.semantic_id:
            replacement_statements.append(item.model_copy(update={
                "method": "equal",
                "minimum_weight": None,
                "maximum_weight": None,
                "cash_remainder_asset": None,
            }))
        else:
            replacement_statements.append(item)
    topology_strategy = strategy.model_copy(update={
        "program": strategy.program.model_copy(update={"statements": tuple(replacement_statements)}),
    })
    plan = compile_strategy_to_lean_plan(lower_v2_to_v1(topology_strategy))
    if len(plan.momentum_selections) != 1:
        raise V2LoweringError("score-proportional lowering requires one typed Selection plan")
    lowered_selection = replace(
        plan.momentum_selections[0],
        score_component_id=ranking.semantic_id,
        score_field="selection.ranking",
        ranking_value=ranking_value,
        lookback_bars=max(0, _lean_value_observations(ranking_value) - 1),
    )
    sleeves = tuple(
        replace(
            sleeve,
            weighting_method="proportional_score",
            allocation_component_id=allocation.semantic_id,
        )
        if sleeve.selection_id == lowered_selection.id
        else sleeve
        for sleeve in plan.target_sleeves
    )
    return normalize_lean_plan(replace(
        plan,
        strategy_identity=semantic_content_hash(strategy.model_dump(mode="json")),
        momentum_selections=(lowered_selection,),
        target_sleeves=sleeves,
    ))


def _lean_value_observations(value: LeanValue) -> int:
    if value.kind == "literal":
        return 0
    if value.kind == "current_price":
        return 1
    if value.kind == "trailing_return":
        return int(value.observations or 0) + 1
    if value.kind == "rolling_price":
        return int(value.observations or 0)
    if value.kind == "scale" and value.operand is not None:
        return _lean_value_observations(value.operand)
    if value.kind == "weighted_score":
        return max((_lean_value_observations(term.value) for term in value.score_terms), default=0)
    return 0


def _lean_daily_value(value: DailyValueNode) -> LeanValue:
    if value.kind == "literal":
        return LeanValue(
            kind="literal", value_type="decimal", literal=value.value,
        )
    if (
        value.kind == "trailing_return"
        and value.operands
        and value.operands[0].subject_kind == SubjectKind.CANDIDATE
    ):
        return LeanValue(
            kind="trailing_return", value_type="percentage", subject="candidate",
            observations=value.observations,
        )
    if (
        value.kind == "observe"
        and value.subject_kind == SubjectKind.CANDIDATE
        and value.field == MarketField.CLOSE
        and value.basis == PriceBasis.ADJUSTED
    ):
        return LeanValue(kind="current_price", value_type="money_per_share", subject="candidate")
    if (
        value.kind == "sma"
        and value.operands
        and value.operands[0].subject_kind == SubjectKind.CANDIDATE
    ):
        return LeanValue(
            kind="rolling_price", value_type="money_per_share", subject="candidate",
            observations=value.observations, aggregate="mean",
        )
    if value.kind == "arithmetic" and value.arithmetic == "multiply":
        for operand, factor in ((value.operands[0], value.operands[1]), (value.operands[1], value.operands[0])):
            if factor.kind == "literal" and factor.value is not None:
                return LeanValue(
                    kind="scale", value_type="decimal", operand=_lean_daily_value(operand),
                    factor=factor.value,
                )
    raise V2LoweringError(f"DailyValue {value.kind!r} has no weighted-Score LEAN lowering")


def _lean_score_value(score: ScoreValueV2) -> LeanValue:
    terms: list[LeanScoreTerm] = []
    for term in score.terms:
        if not isinstance(term.value, DailyValueNode):
            raise V2LoweringError(
                "weighted-Score LEAN lowering currently requires scalar DailyValue terms"
            )
        terms.append(LeanScoreTerm(value=_lean_daily_value(term.value), weight=term.weight))
    return LeanValue(
        kind="weighted_score",
        value_type="decimal",
        score_terms=tuple(terms),
        missing_policy=score.missing_policy,
        normalization=score.normalization,
        clamp_min=score.clamp_min,
        clamp_max=score.clamp_max,
    )
