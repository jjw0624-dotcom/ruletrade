from datetime import date
from decimal import Decimal

import pytest

from ruletrade.compiler.frontend import desugar_strategy
from ruletrade.compiler.lean import generate_csharp, lower_to_lean_plan
from ruletrade.datasets import DatasetRegistry
from ruletrade.ir.strategy import UniverseOp
from ruletrade.strategy.v1.models import (
    AssetSetDefinition,
    ArithmeticExpression,
    CandidateExpression,
    CanonicalStrategyV1,
    ComparisonExpression,
    Component,
    Connection,
    CurrentExpression,
    Entrypoint,
    GroupDefinition,
    GroupRefExpression,
    IndicatorExpression,
    LiteralExpression,
    MarketSeriesExpression,
    PortReference,
    RollingAggregateExpression,
    StrategyDefinitions,
    StrategyGraph,
    StrategyMetadata,
    UniverseDefinition,
)
from ruletrade.strategy.v1.validation import collect_semantic_issues, validate_strategy_v1
from ruletrade.strategy.v1.semantics import project_semantic_composition
from ruletrade.strategy.v1.value_semantics import (
    DatasetValueEvaluator,
    StrategyValueProvenance,
    ValueEvaluationError,
    ValueEvaluationRequest,
    value_capabilities,
)


def ref(component_id: str, port: str) -> PortReference:
    return PortReference(component_id=component_id, port=port)


def universe_strategy() -> CanonicalStrategyV1:
    candidate_return = IndicatorExpression(
        indicator_id="trailing_return_indicator@1",
        asset=CandidateExpression(),
        parameters={"lookback_bars": 2},
    )
    components = (
        Component(id="event", primitive="daily@1"),
        Component(id="universe", primitive="universe@1", config={"universe_ref": "growth_candidates"}),
        Component(id="score", primitive="trailing_return@1", config={"lookback_bars": 2}),
        Component(
            id="eligible",
            primitive="filter@1",
            config={"operator": "gt", "threshold": Decimal("0")},
            condition=ComparisonExpression(
                operator="gt",
                left=candidate_return,
                right=LiteralExpression(value_type="percentage", value=Decimal("0")),
            ),
        ),
        Component(
            id="rank",
            primitive="rank@1",
            config={"direction": "descending"},
            value_expression=candidate_return,
        ),
        Component(id="take", primitive="top_n@1", config={"count": 1, "shortage_policy": "choose_all"}),
        Component(id="weights", primitive="equal_weight@1", config={"total": Decimal("1")}),
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
        metadata=StrategyMetadata(name="Semantic universe"),
        definitions=StrategyDefinitions(
            asset_sets=(AssetSetDefinition(id="growth_assets", assets=["QQQ", "VGT"]),),
            groups=(GroupDefinition(id="growth", name="Growth", asset_set_ref="growth_assets"),),
            universes=(
                UniverseDefinition(
                    id="growth_candidates",
                    name="Growth candidates",
                    source="group",
                    group_ref="growth",
                ),
            ),
        ),
        graph=StrategyGraph(components=components, connections=connections),
        entrypoints=(Entrypoint(event_component_id="event", target_component_id="rebalance"),),
    )


def test_universe_group_identity_round_trips_and_reaches_lean() -> None:
    strategy = universe_strategy()
    validate_strategy_v1(strategy)
    reopened = CanonicalStrategyV1.model_validate(strategy.model_dump(mode="json"))
    assert reopened.definitions.groups[0].id == "growth"
    assert reopened.definitions.universes[0].group_ref == "growth"
    universe_fact = next(
        item for item in project_semantic_composition(reopened).facts
        if item.category.value == "universe"
    )
    assert universe_fact.detail["universe_id"] == "growth_candidates"
    assert tuple(universe_fact.detail["assets"]) == ("QQQ", "VGT")
    ir = desugar_strategy(reopened)
    universe = next(item for item in ir.operations if isinstance(item, UniverseOp))
    assert universe.source_kind == "group"
    assert universe.symbols == ("QQQ", "VGT")
    source = generate_csharp(lower_to_lean_plan(reopened))
    assert 'AddEquity("QQQ"' in source
    assert 'AddEquity("VGT"' in source


def test_provider_universe_is_honest_semantic_only() -> None:
    strategy = universe_strategy()
    provider = UniverseDefinition(
        id="growth_candidates",
        name="All US stocks",
        source="provider",
        provider_id="future-security-master",
        query="country=US AND security_type=equity",
    )
    strategy = strategy.model_copy(
        update={"definitions": strategy.definitions.model_copy(update={"universes": (provider,)})}
    )
    validate_strategy_v1(strategy)
    with pytest.raises(ValueError, match="semantic-only"):
        desugar_strategy(strategy)


def test_group_has_identity_but_no_implicit_series() -> None:
    strategy = universe_strategy()
    rank = next(item for item in strategy.graph.components if item.id == "rank")
    invalid = CurrentExpression(series=GroupRefExpression(group_id="growth"))
    rank = rank.model_copy(update={"value_expression": invalid})
    strategy = strategy.model_copy(update={"graph": strategy.graph.model_copy(update={
        "components": tuple(rank if item.id == "rank" else item for item in strategy.graph.components)
    })})
    assert any("expected a market series" in issue.message for issue in collect_semantic_issues(strategy))


def test_point_in_time_price_and_rolling_mean_never_read_future_rows(tmp_path) -> None:
    (tmp_path / "prices.csv").write_text(
        "date,QQQ\n2024-01-01,100\n2024-01-02,110\n2024-01-03,1000\n",
        encoding="utf-8",
    )
    evaluator = DatasetValueEvaluator(DatasetRegistry(tmp_path))
    series = MarketSeriesExpression(
        field="price",
        subject=LiteralExpression(value_type="asset", value="QQQ"),
    )
    evidence = evaluator.evaluate(ValueEvaluationRequest(
        dataset_id="prices",
        expression=RollingAggregateExpression(operator="mean", series=series, window_observations=2),
        as_of=date(2024, 1, 2),
        context="historical",
        provenance=StrategyValueProvenance(component_id="rank", field_path="value_expression"),
    ))
    assert evidence.observed == Decimal("105")
    assert evidence.observed_at == date(2024, 1, 2)
    assert evidence.as_of == date(2024, 1, 2)
    assert evidence.subject_id == "QQQ"
    assert evidence.provenance.component_id == "rank"

    scaled = evaluator.evaluate(ValueEvaluationRequest(
        dataset_id="prices",
        expression=ArithmeticExpression(
            operator="multiply",
            left=RollingAggregateExpression(operator="mean", series=series, window_observations=2),
            right=LiteralExpression(value_type="decimal", value=Decimal("2.5")),
        ),
        as_of=date(2024, 1, 2),
        context="historical",
    ))
    assert scaled.observed == Decimal("262.5")


def test_candidate_current_price_requires_context_and_volume_is_not_fabricated(tmp_path) -> None:
    (tmp_path / "prices.csv").write_text(
        "date,QQQ\n2024-01-01,100\n2024-01-02,110\n",
        encoding="utf-8",
    )
    evaluator = DatasetValueEvaluator(DatasetRegistry(tmp_path))
    current_price = CurrentExpression(
        series=MarketSeriesExpression(field="price", subject=CandidateExpression())
    )
    request = ValueEvaluationRequest(
        dataset_id="prices", expression=current_price, as_of=date(2024, 1, 2), context="historical"
    )
    with pytest.raises(ValueEvaluationError, match="Selection context"):
        evaluator.evaluate(request)
    evidence = evaluator.evaluate(request.model_copy(update={"candidate_asset": "qqq"}))
    assert evidence.subject_kind == "candidate"
    assert evidence.observed == Decimal("110.0")

    volume = request.model_copy(update={
        "expression": CurrentExpression(
            series=MarketSeriesExpression(field="volume", subject=CandidateExpression())
        ),
        "candidate_asset": "QQQ",
    })
    with pytest.raises(ValueEvaluationError, match="no volume"):
        evaluator.evaluate(volume)


def test_capabilities_separate_model_provider_and_compiler_support() -> None:
    capabilities = {item.id: item for item in value_capabilities()}
    assert capabilities["market.trailing_return"].strategy_compiler_supported
    assert capabilities["market.price.current"].dataset_evaluation_supported
    assert not capabilities["market.price.current"].strategy_compiler_supported
    assert not capabilities["market.volume.current"].dataset_evaluation_supported


def test_typed_price_ranking_fails_honestly_until_compiler_support() -> None:
    strategy = universe_strategy()
    rank = next(item for item in strategy.graph.components if item.id == "rank")
    rank = rank.model_copy(update={"value_expression": CurrentExpression(
        series=MarketSeriesExpression(field="price", subject=CandidateExpression())
    )})
    strategy = strategy.model_copy(update={"graph": strategy.graph.model_copy(update={
        "components": tuple(rank if item.id == "rank" else item for item in strategy.graph.components)
    })})
    validate_strategy_v1(strategy)
    with pytest.raises(ValueError, match="evaluation-only"):
        desugar_strategy(strategy)
