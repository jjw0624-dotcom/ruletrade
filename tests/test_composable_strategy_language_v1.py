from decimal import Decimal

from ruletrade.compiler.frontend import desugar_strategy
from ruletrade.compiler.lean import generate_csharp, lower_to_lean_plan
from ruletrade.ir.strategy import FilterOp, RankOp, TopNOp
from ruletrade.strategy.v1.models import (
    AssetSetDefinition, BooleanExpression, CandidateExpression, CanonicalStrategyV1,
    ComparisonExpression, Component, Connection, Entrypoint, IndicatorExpression,
    LiteralExpression, PortReference, StrategyDefinitions, StrategyGraph, StrategyMetadata,
)
from ruletrade.strategy.v1.validation import collect_semantic_issues, validate_strategy_v1


def ref(component_id: str, port: str) -> PortReference:
    return PortReference(component_id=component_id, port=port)


def strategy() -> CanonicalStrategyV1:
    candidate_return = IndicatorExpression(
        indicator_id="trailing_return_indicator@1",
        asset=CandidateExpression(),
        parameters={"lookback_bars": 20},
    )
    eligibility = BooleanExpression(operator="and", operands=[
        ComparisonExpression(operator="gte", left=candidate_return, right=LiteralExpression(value_type="percentage", value=Decimal("-0.10"))),
        ComparisonExpression(operator="lte", left=candidate_return, right=LiteralExpression(value_type="percentage", value=Decimal("0.50"))),
    ])
    components = (
        Component(id="event", primitive="daily@1"),
        Component(id="universe", primitive="asset_set@1", config={"asset_set_ref": "assets"}),
        Component(id="score", primitive="trailing_return@1", config={"lookback_bars": 20}),
        Component(id="eligible", primitive="filter@1", config={"operator": "gt", "threshold": Decimal(0)}, condition=eligibility),
        Component(id="rank", primitive="rank@1", config={"direction": "ascending"}, value_expression=candidate_return),
        Component(id="take", primitive="top_n@1", config={"count": 2, "shortage_policy": "choose_all"}),
        Component(id="weights", primitive="equal_weight@1", config={"total": Decimal(1)}),
        Component(id="rebalance", primitive="rebalance@1"),
    )
    connections = (
        Connection(source=ref("universe", "assets"), target=ref("score", "assets")),
        Connection(source=ref("score", "scores"), target=ref("eligible", "scores")),
        Connection(source=ref("eligible", "scores"), target=ref("rank", "scores")),
        Connection(source=ref("rank", "ranked"), target=ref("take", "ranked")),
        Connection(source=ref("take", "selected"), target=ref("weights", "assets")),
        Connection(source=ref("weights", "targets"), target=ref("rebalance", "targets")),
    )
    return CanonicalStrategyV1(
        metadata=StrategyMetadata(name="Composable selection"),
        definitions=StrategyDefinitions(asset_sets=(AssetSetDefinition(id="assets", assets=["QQQ", "IEF", "SPY"]),)),
        graph=StrategyGraph(components=components, connections=connections),
        entrypoints=(Entrypoint(event_component_id="event", target_component_id="rebalance"),),
    )


def test_candidate_all_direction_and_shortage_reach_ir_and_codegen() -> None:
    value = strategy()
    validate_strategy_v1(value)
    ir = desugar_strategy(value)
    filter_op = next(item for item in ir.operations if isinstance(item, FilterOp))
    rank = next(item for item in ir.operations if isinstance(item, RankOp))
    top_n = next(item for item in ir.operations if isinstance(item, TopNOp))
    assert [(item.operator, item.threshold) for item in filter_op.clauses] == [
        ("gte", Decimal("-0.10")), ("lte", Decimal("0.50"))
    ]
    assert rank.direction == "ascending"
    assert top_n.shortage_policy == "choose_all"
    source = generate_csharp(lower_to_lean_plan(value))
    assert ".Where(item => item.Value >= -0.1m && item.Value <= 0.5m)" in source
    assert ".OrderBy(item => item.Value)" in source


def test_candidate_reference_is_not_a_predicate() -> None:
    value = strategy()
    rule = value.graph.components[-1].model_copy(update={
        "primitive": "rule@1",
        "condition": ComparisonExpression(
            operator="gt",
            left=IndicatorExpression(indicator_id="trailing_return_indicator@1", asset=CandidateExpression(), parameters={"lookback_bars": 20}),
            right=LiteralExpression(value_type="percentage", value=Decimal(0)),
        ),
        "actions": (),
    })
    candidate = value.model_copy(update={"graph": value.graph.model_copy(update={"components": (*value.graph.components[:-1], rule), "connections": value.graph.connections[:-1]})})
    assert any("Predicate cannot reference" in issue.message for issue in collect_semantic_issues(candidate))
