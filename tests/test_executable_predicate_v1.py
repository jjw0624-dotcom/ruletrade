from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_strategy_service
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.decision_evidence import collect_decision_evidence
from ruletrade.strategy.v1.authoring import (
    AddPredicateOperation,
    RemovePredicateOperation,
    StructuralAuthoringError,
    UpdatePredicateOperation,
    apply_structural_operation,
    structural_authoring_capabilities,
)
from ruletrade.strategy.v1.fixtures import one_investment_strategy
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.semantics import project_semantic_composition
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService


def predicate_strategy() -> CanonicalStrategyV1:
    return apply_structural_operation(
        one_investment_strategy(),
        AddPredicateOperation(
            rebalance_component_id="rebalance",
            asset="SPY",
            lookback_bars=126,
            operator="gt",
            threshold=Decimal("0"),
        ),
    )


def test_predicate_authoring_is_capability_driven_atomic_and_invertible() -> None:
    original = one_investment_strategy()
    capabilities = structural_authoring_capabilities(original)
    assert capabilities.predicate_add_targets == ("rebalance",)
    assert capabilities.predicate_remove_targets == ()

    created = predicate_strategy()
    rule = next(item for item in created.graph.components if item.id == "rebalance")
    assert rule.primitive == "rule@1"
    assert rule.condition is not None
    assert rule.actions[0].kind == "rebalance"
    assert structural_authoring_capabilities(created).predicate_remove_targets == ("rebalance",)

    restored = apply_structural_operation(created, RemovePredicateOperation(component_id="rebalance"))
    assert restored == original

    with pytest.raises(StructuralAuthoringError, match="not available"):
        apply_structural_operation(
            original,
            AddPredicateOperation(rebalance_component_id="weights", asset="SPY"),
        )
    assert original == one_investment_strategy()


def test_predicate_fields_update_without_changing_component_identity() -> None:
    strategy = predicate_strategy()
    updated = apply_structural_operation(
        strategy,
        UpdatePredicateOperation(
            component_id="rebalance",
            asset="QQQ",
            lookback_bars=63,
            operator="lte",
            threshold=Decimal("-0.05"),
        ),
    )
    rule = next(item for item in updated.graph.components if item.id == "rebalance")
    payload = rule.condition.model_dump(mode="json") if rule.condition else {}
    assert payload["left"]["asset"]["value"] == "QQQ"
    assert payload["left"]["parameters"]["lookback_bars"] == 63
    assert payload["operator"] == "lte"
    assert payload["right"]["value"] == "-0.05"


def test_predicate_projects_as_control_with_nested_action() -> None:
    projection = project_semantic_composition(predicate_strategy())
    predicate = next(item for item in projection.facts if item.category == "predicate")
    assert predicate.ref.primary_component_id == "rebalance"
    assert predicate.ref.field_path == "condition"
    assert predicate.detail["asset"] == "SPY"
    control = next(
        statement
        for script in projection.logic.scripts
        for statement in script.statements
        if statement.family == "control"
    )
    assert control.label == "IF SPY 126-bar return > 0"
    assert control.then_statement_ids == ("statement:action:rebalance:0",)
    assert control.else_statement_ids == ()


def test_predicate_compiles_to_completed_observation_and_evidence() -> None:
    plan = compile_strategy_to_lean_plan(predicate_strategy())
    predicate = plan.rebalances[0].predicate
    assert predicate is not None
    assert (predicate.asset, predicate.lookback_bars, predicate.operator, predicate.threshold) == (
        "SPY",
        126,
        "gt",
        Decimal("0"),
    )
    source = generate_csharp(plan)
    assert "predicateWindow0_0[126]" in source
    assert "predicateWindow0_0[0] / predicateWindow0_0[126] - 1m" in source
    assert '"predicate"' in source
    assert "if (!predicateOutcome0_0) return;" in source
    assert source.index("if (!predicateOutcome0_0) return;") < source.index("SetHoldings")


def test_predicate_evidence_round_trips_exact_canonical_provenance() -> None:
    record = (
        "RULETRADE_EVIDENCE_V2|sequence=1|session=2025-03-03|phase=evaluation|kind=predicate|"
        "predicate_component=rebalance|predicate_field=condition|asset=SPY|measure=trailing_return|"
        "lookback_bars=126|operator=gt|observed=0.031|threshold=0|outcome=true|branch=then"
    )
    event = collect_decision_evidence(record)[0]
    assert event.source_components[0].component_id == "rebalance"
    assert event.source_components[0].field_path == "condition"
    assert event.evidence.kind == "predicate"
    assert event.evidence.observed == Decimal("0.031")
    assert event.evidence.branch == "then"


def test_existing_canonical_payload_needs_no_migration() -> None:
    payload = deepcopy(one_investment_strategy().model_dump(mode="json"))
    for component in payload["graph"]["components"]:
        component.pop("else_actions", None)
    restored = CanonicalStrategyV1.model_validate(payload)
    assert all(component.else_actions == () for component in restored.graph.components)


def test_predicate_authoring_saves_and_reopens_through_fastapi_sqlite(tmp_path: Path) -> None:
    service = StrategyService(SQLiteStrategyRepository(tmp_path / "predicate.sqlite3"))
    app.dependency_overrides[get_strategy_service] = lambda: service
    try:
        with TestClient(app) as client:
            source = one_investment_strategy().model_dump(mode="json")
            created = client.post(
                "/v1/strategies", json={"name": "Predicate lifecycle", "canonical_strategy": source}
            )
            assert created.status_code == 201
            strategy_id = created.json()["strategy"]["id"]
            revision_id = created.json()["current_revision"]["id"]

            capabilities = client.post(
                "/v1/canonical/strategies/authoring/capabilities", json=source
            )
            assert capabilities.json()["predicate_add_targets"] == ["rebalance"]
            applied = client.post(
                "/v1/canonical/strategies/authoring/apply",
                json={
                    "strategy": source,
                    "operation": {
                        "kind": "add_predicate",
                        "rebalance_component_id": "rebalance",
                        "asset": "SPY",
                        "lookback_bars": 126,
                        "operator": "gt",
                        "threshold": "0",
                    },
                },
            )
            assert applied.status_code == 200, applied.text
            predicate_source = applied.json()["strategy"]
            assert compile_strategy_to_lean_plan(
                CanonicalStrategyV1.model_validate(predicate_source)
            ).rebalances[0].predicate is not None

            saved = client.post(
                f"/v1/strategies/{strategy_id}/revisions",
                json={
                    "expected_parent_revision_id": revision_id,
                    "canonical_strategy": predicate_source,
                },
            )
            assert saved.status_code == 201
            reopened = client.get(f"/v1/strategies/{strategy_id}")
            assert reopened.json()["current_revision"]["canonical_strategy"] == predicate_source
    finally:
        app.dependency_overrides.clear()
