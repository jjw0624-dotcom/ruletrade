from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.strategy.v1.authoring import SleeveAllocationInput, StructuralAuthoringError
from ruletrade.strategy.v1.composition import (
    ComposeStrategyOperation,
    CompositionError,
    CreateComponentMutation,
    DisconnectMutation,
    PortAddress,
    apply_composition,
)
from ruletrade.strategy.v1.fixtures import (
    cooldown_strategy,
    fallback_momentum_strategy,
    filter_screening_strategy,
    golden_stateful_rule_strategy,
    independent_schedules_strategy,
    momentum_top_n_strategy,
    one_investment_strategy,
    portfolio_sleeves_strategy,
)
from ruletrade.strategy.v1.semantics import (
    ConfigureAllocationIntent,
    ConfigureEligibilityIntent,
    ConfigurePredicateIntent,
    ConfigureSelectionIntent,
    InformationPlacement,
    SemanticCategory,
    SemanticIntentError,
    apply_semantic_intent,
    project_semantic_composition,
    resolve_semantic_intent,
)
from ruletrade.strategy.v1.validation import validate_strategy_v1

EXECUTABLE_FIXTURES = (
    one_investment_strategy,
    momentum_top_n_strategy,
    filter_screening_strategy,
    fallback_momentum_strategy,
    cooldown_strategy,
    portfolio_sleeves_strategy,
    independent_schedules_strategy,
)
client = TestClient(app)


def _covered_component_ids(projection) -> set[str]:
    return {
        component_id
        for fact in projection.facts
        for component_id in (fact.ref.primary_component_id, *fact.ref.related_component_ids)
        if component_id is not None
    }


@pytest.mark.parametrize("fixture", EXECUTABLE_FIXTURES)
def test_current_executable_grammar_projects_without_silent_component_loss(fixture) -> None:
    strategy = fixture()
    projection = project_semantic_composition(strategy)

    assert _covered_component_ids(projection) == {item.id for item in strategy.graph.components}
    assert {item.fact_id for item in projection.flow.placements} == {item.id for item in projection.facts}
    assert {item.fact_id for item in projection.logic.placements} == {item.id for item in projection.facts}
    assert all(item.placement != InformationPlacement.UNSUPPORTED for item in projection.flow.placements)
    assert all(item.placement != InformationPlacement.UNSUPPORTED for item in projection.logic.placements)


def test_semantic_categories_preserve_domain_distinctions() -> None:
    projection = project_semantic_composition(filter_screening_strategy())
    categories = {item.category for item in projection.facts}

    assert SemanticCategory.ELIGIBILITY in categories
    assert SemanticCategory.PREDICATE not in categories
    assert SemanticCategory.SELECTION in categories
    assert SemanticCategory.ACTION in categories
    assert SemanticCategory.ALLOCATION in categories
    assert len({SemanticCategory.SELECTION, SemanticCategory.ACTION, SemanticCategory.ALLOCATION}) == 3
    assert SemanticCategory.CONSTRAINT != SemanticCategory.ACTION
    assert SemanticCategory.PORTFOLIO != SemanticCategory.SELECTION

    control = project_semantic_composition(golden_stateful_rule_strategy())
    assert any(item.category == SemanticCategory.PREDICATE for item in control.facts)
    assert any(item.category == SemanticCategory.STATE for item in control.facts)
    assert all(item.category != SemanticCategory.ELIGIBILITY for item in control.facts)


def test_ranked_selection_aggregates_exact_canonical_provenance() -> None:
    projection = project_semantic_composition(filter_screening_strategy())
    selection = next(item for item in projection.facts if item.kind == "ranked_selection")

    assert selection.ref.primary_component_id == "top_n"
    assert set(selection.ref.related_component_ids) == {
        "universe_assets",
        "momentum",
        "positive_return",
        "momentum_rank",
    }
    statement = next(
        item
        for script in projection.logic.scripts
        for item in script.statements
        if item.kind == "ranked_selection"
    )
    assert set(statement.fact_ids) >= {
        "selection:top_n",
        "universe:universe_assets",
        "measure:momentum",
        "eligibility:positive_return",
    }


def test_flow_and_logic_are_distinct_structures_over_the_same_facts() -> None:
    projection = project_semantic_composition(portfolio_sleeves_strategy())

    assert {item.family for item in projection.flow.units} >= {"entity", "distribution", "routing", "action"}
    assert {item.kind for item in projection.logic.contexts} >= {"portfolio", "sleeve"}
    assert any(
        item.kind == "compound_allocation"
        for script in projection.logic.scripts
        for item in script.statements
    )
    assert {item.fact_id for item in projection.flow.placements} == {
        item.fact_id for item in projection.logic.placements
    }


def test_independent_schedules_become_multiple_scripts_and_contexts() -> None:
    projection = project_semantic_composition(independent_schedules_strategy())

    assert len(projection.logic.scripts) == 3
    assert {item.kind for item in projection.logic.contexts} == {"portfolio", "sleeve"}
    assert len({item.trigger.timing_fact_id for item in projection.logic.scripts}) == 2


def test_selection_fallback_is_not_control_flow_otherwise() -> None:
    projection = project_semantic_composition(fallback_momentum_strategy())
    fallback = next(item for item in projection.facts if item.kind == "selection_fallback")

    assert fallback.category == SemanticCategory.SELECTION
    assert all(item.category != SemanticCategory.PREDICATE for item in projection.facts)
    statement = next(
        item
        for script in projection.logic.scripts
        for item in script.statements
        if item.kind == "ranked_selection"
    )
    assert fallback.id in statement.modifier_fact_ids
    assert not statement.else_statement_ids


def test_semantic_selection_intent_resolves_to_one_atomic_batch() -> None:
    strategy = momentum_top_n_strategy()
    intent = ConfigureSelectionIntent(
        selection_component_id="top_n",
        count=1,
        measure_component_id="momentum",
        lookback_bars=63,
    )
    operation = resolve_semantic_intent(intent)
    assert isinstance(operation, ComposeStrategyOperation)

    changed = apply_semantic_intent(strategy, intent)
    assert next(item for item in changed.graph.components if item.id == "top_n").config["count"] == 1
    assert (
        next(item for item in changed.graph.components if item.id == "momentum").config["lookback_bars"] == 63
    )
    validate_strategy_v1(changed)


def test_semantic_eligibility_and_simultaneous_allocation_intents_use_existing_authority() -> None:
    filtered = apply_semantic_intent(
        filter_screening_strategy(),
        ConfigureEligibilityIntent(eligibility_component_id="positive_return", threshold=Decimal("-0.05")),
    )
    assert next(item for item in filtered.graph.components if item.id == "positive_return").config[
        "threshold"
    ] == Decimal("-0.05")

    allocated = apply_semantic_intent(
        portfolio_sleeves_strategy(),
        ConfigureAllocationIntent(
            allocations=(
                SleeveAllocationInput(component_id="growth_sleeve", allocation=Decimal("0.6")),
                SleeveAllocationInput(component_id="defensive_sleeve", allocation=Decimal("0.4")),
            )
        ),
    )
    values = {item.id: item.config.get("allocation") for item in allocated.graph.components}
    assert values["growth_sleeve"] == Decimal("0.6")
    assert values["defensive_sleeve"] == Decimal("0.4")


def test_unsupported_predicate_intent_and_invalid_batch_leave_canonical_unchanged() -> None:
    strategy = momentum_top_n_strategy()
    before = strategy.model_dump(mode="json")
    with pytest.raises(SemanticIntentError, match="control predicates"):
        apply_semantic_intent(strategy, ConfigurePredicateIntent(predicate_component_id="future"))
    with pytest.raises(CompositionError, match="invalid"):
        apply_composition(
            strategy,
            ComposeStrategyOperation(
                mutations=(
                    DisconnectMutation(
                        source=PortAddress(component_id="momentum", port="scores"),
                        target=PortAddress(component_id="momentum_rank", port="scores"),
                    ),
                )
            ),
        )
    assert strategy.model_dump(mode="json") == before
    with pytest.raises(StructuralAuthoringError, match="greater than the number"):
        apply_semantic_intent(
            strategy,
            ConfigureSelectionIntent(selection_component_id="top_n", count=99),
        )
    assert strategy.model_dump(mode="json") == before


def test_draft_required_gestures_fail_final_canonical_validation() -> None:
    strategy = one_investment_strategy()
    with pytest.raises(CompositionError, match="required input is not connected"):
        apply_composition(
            strategy,
            ComposeStrategyOperation(
                mutations=(
                    CreateComponentMutation(
                        ref="unwired_measure", primitive="trailing_return@1", config={"lookback_bars": 126}
                    ),
                )
            ),
        )
    with pytest.raises(CompositionError, match="required input is not connected"):
        apply_composition(
            strategy,
            ComposeStrategyOperation(
                mutations=(
                    CreateComponentMutation(
                        ref="empty_sleeve",
                        primitive="portfolio_sleeve@1",
                        config={"name": "Empty", "allocation": "0.5"},
                    ),
                )
            ),
        )


def test_headless_projection_and_semantic_intent_endpoints_return_authoritative_canonical() -> None:
    strategy = filter_screening_strategy()
    projected = client.post(
        "/v1/canonical/strategies/semantic-projections",
        json=strategy.model_dump(mode="json"),
    )
    assert projected.status_code == 200
    assert {item["category"] for item in projected.json()["facts"]} >= {
        "universe",
        "measure",
        "eligibility",
        "selection",
        "allocation",
        "timing",
        "action",
    }

    changed = client.post(
        "/v1/canonical/strategies/semantic-intents/apply",
        json={
            "strategy": strategy.model_dump(mode="json"),
            "intent": {
                "kind": "configure_eligibility",
                "eligibility_component_id": "positive_return",
                "threshold": "-0.05",
            },
        },
    )
    assert changed.status_code == 200
    component = next(
        item for item in changed.json()["strategy"]["graph"]["components"] if item["id"] == "positive_return"
    )
    assert component["config"]["threshold"] == "-0.05"

    rejected = client.post(
        "/v1/canonical/strategies/semantic-intents/apply",
        json={
            "strategy": strategy.model_dump(mode="json"),
            "intent": {"kind": "configure_predicate", "predicate_component_id": "future"},
        },
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "predicate_authoring_deferred"
