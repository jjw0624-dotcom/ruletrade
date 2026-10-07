"""Narrow, explicit v2 -> maintained v1 compiler bridge.

This is intentionally not a silent migration.  It only lowers the demonstrated
daily static-Universe Selection subset after v2 semantic validation succeeds.
"""
from __future__ import annotations

from decimal import Decimal

from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.strategy.v1.models import (
    AssetSetDefinition,
    CandidateExpression,
    CanonicalStrategyV1,
    ComparisonExpression,
    Component,
    Connection,
    Entrypoint,
    GroupDefinition,
    IndicatorExpression,
    LiteralExpression,
    PortReference,
    StrategyDefinitions,
    StrategyGraph,
    UniverseDefinition,
)
from ruletrade.strategy.v1.validation import validate_strategy_v1
from ruletrade.strategy.v2.models import (
    CandidateCurrentPriceValue,
    CandidateTrailingReturnValue,
    CanonicalStrategyV2,
    ComparisonV2,
    LiteralValue,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.validation import validate_strategy_v2


class V2LoweringError(ValueError):
    pass


def _port(component_id: str, port: str) -> PortReference:
    return PortReference(component_id=component_id, port=port)


def _value(expression: ValueExpressionV2):
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


def _comparison(value: ComparisonV2) -> ComparisonExpression:
    return ComparisonExpression(operator=value.operator, left=_value(value.left), right=_value(value.right))


def lower_v2_to_v1(strategy: CanonicalStrategyV2) -> CanonicalStrategyV1:
    diagnostics = validate_strategy_v2(strategy)
    if diagnostics:
        rendered = "; ".join(f"{item.path}: {item.code}" for item in diagnostics)
        raise V2LoweringError(f"v2 semantic validation failed: {rendered}")

    selection = strategy.selection
    universe = next((item for item in strategy.definitions.groups if item.id == selection.universe_id), None)
    if universe is None:
        raise V2LoweringError("Profile A bridge currently requires a Group-backed static Universe")

    components = (
        Component(id="event", primitive="daily@1"),
        Component(id="universe", primitive="universe@1", config={"universe_ref": "candidates"}),
        Component(id="score", primitive="trailing_return@1", config={
            "lookback_bars": selection.ranking.lookback_observations
            if isinstance(selection.ranking, CandidateTrailingReturnValue) else 1,
        }),
        Component(
            id="eligible",
            primitive="filter@1",
            config={"operator": "gt", "threshold": Decimal(0)},
            condition=_comparison(selection.eligibility) if selection.eligibility else None,
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
    )
    v1 = CanonicalStrategyV1(
        metadata=strategy.metadata,
        definitions=StrategyDefinitions(
            asset_sets=strategy.definitions.asset_sets,
            groups=strategy.definitions.groups,
            universes=(UniverseDefinition(
                id="candidates", name="v2 candidates", source="group", group_ref=universe.id,
            ),),
        ),
        graph=StrategyGraph(
            components=components,
            connections=(
                Connection(source=_port("universe", "assets"), target=_port("score", "assets")),
                Connection(source=_port("score", "scores"), target=_port("eligible", "scores")),
                Connection(source=_port("eligible", "scores"), target=_port("rank", "scores")),
                Connection(source=_port("rank", "ranked"), target=_port("take", "ranked")),
                Connection(source=_port("take", "selected"), target=_port("weights", "assets")),
                Connection(source=_port("weights", "targets"), target=_port("rebalance", "targets")),
            ),
        ),
        entrypoints=(Entrypoint(event_component_id="event", target_component_id="rebalance"),),
    )
    validate_strategy_v1(v1)
    return v1


def compile_v2_strategy_to_lean_plan(strategy: CanonicalStrategyV2):
    """Production-connected proof: v2 validation -> explicit bridge -> maintained compiler."""

    return compile_strategy_to_lean_plan(lower_v2_to_v1(strategy))
