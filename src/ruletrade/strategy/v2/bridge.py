"""Narrow, explicit v2 -> maintained v1 compiler bridge.

This is intentionally not a silent migration.  It only lowers the demonstrated
daily static-Universe Selection subset after v2 semantic validation succeeds.
"""
from __future__ import annotations

from decimal import Decimal

from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
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
    CanonicalStrategyV2,
    BooleanGroupV2,
    ComparisonV2,
    ConditionV2,
    LiteralValue,
    NotConditionV2,
    ProgramStatementV2,
    SelectionStatementV2,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind
from ruletrade.strategy.v2.validation import validate_strategy_v2


class V2LoweringError(ValueError):
    pass


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


def _program_selection(strategy: CanonicalStrategyV2) -> tuple[SelectionStatementV2, str]:
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
    if len(allocations) != 1 or allocations[0].method != "equal":
        raise V2LoweringError("production Program lowering requires one equal allocation for the Selection")
    clock_id = selection.clock_id or allocations[0].clock_id
    clock = next((item for item in strategy.program.clocks if item.id == clock_id), strategy.program.clocks[0])
    if clock.timeframe not in {"daily", "monthly"}:
        raise V2LoweringError(f"{clock.timeframe} Program timing has no maintained LEAN lowering")
    return selection, clock.timeframe


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
        statement, program_timeframe = _program_selection(strategy)
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
    asset_sets = list(strategy.definitions.asset_sets)
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


def compile_v2_strategy_to_lean_plan(strategy: CanonicalStrategyV2):
    """Production-connected proof: v2 validation -> explicit bridge -> maintained compiler."""

    return compile_strategy_to_lean_plan(lower_v2_to_v1(strategy))
