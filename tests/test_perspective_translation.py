from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.authoring import (
    ApplyV2AuthoringRequest,
    ProgramStrategyTemplateRequest,
    SetProgramFallback,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.corpus import (
    composable_semantic_execution_strategy,
    composable_split_execution_strategy,
    strongest_etfs_strategy,
)
from ruletrade.strategy.v2.perspectives import (
    derive_capital_flow,
    derive_decision_logic,
    perspective_bundle,
    semantically_equivalent,
)


client = TestClient(app)


def test_blank_perspectives_do_not_require_lowering(monkeypatch) -> None:
    blank = create_program_strategy_template(ProgramStrategyTemplateRequest(name="Blank"))

    def unavailable(_strategy):
        raise RuntimeError("lowerer intentionally unavailable")

    monkeypatch.setattr("ruletrade.strategy.v2.perspectives.assess_v2_execution_capability", unavailable)
    bundle = perspective_bundle(blank)
    assert bundle.internal.capability.representable
    assert not bundle.internal.capability.backend_lowerable
    assert [item.label for item in bundle.capital_flow.nodes] == ["Portfolio"]
    assert [item.label for item in bundle.decision_logic.blocks] == ["Portfolio"]
    assert "lowerer intentionally unavailable" not in bundle.model_dump_json()


def test_strongest_etfs_preserves_fallback_as_shortage_not_otherwise() -> None:
    strategy = strongest_etfs_strategy()
    flow = derive_capital_flow(strategy)
    logic = derive_decision_logic(strategy)
    fallback = next(item for item in flow.nodes if item.role == "fallback")
    assert fallback.conditionality == "shortage"
    assert any(edge.kind == "fallback_on_shortage" and edge.target_id == fallback.id for edge in flow.edges)
    assert any(item.role == "fallback" for item in logic.blocks)
    assert not any(item.role == "control" for item in logic.blocks)


def test_flow_and_decision_logic_are_distinct_over_one_identity() -> None:
    bundle = perspective_bundle(composable_semantic_execution_strategy())
    assert bundle.capital_flow.semantic_fingerprint == bundle.decision_logic.semantic_fingerprint
    assert {item.role for item in bundle.decision_logic.blocks} >= {
        "selection", "event", "transition", "memory", "policy", "condition", "value",
    }
    assert "memory" not in {item.role for item in bundle.capital_flow.nodes}
    assert len(bundle.capital_flow.nodes) != len(bundle.decision_logic.blocks)


def test_split_is_parallel_capital_and_not_a_sequential_logic_statement() -> None:
    bundle = perspective_bundle(composable_split_execution_strategy())
    split = next(item for item in bundle.capital_flow.nodes if item.role == "split")
    investments = [item for item in bundle.capital_flow.nodes if item.role == "investment"]
    assert len(investments) == 2
    assert all(any(
        edge.source_id == split.id and edge.target_id == investment.id
        and edge.kind == "ownership_share"
        for edge in bundle.capital_flow.edges
    ) for investment in investments)
    assert not any(item.role == "split" for item in bundle.decision_logic.blocks)


def test_perspective_endpoint_returns_addressed_v2_manifests() -> None:
    strategy = strongest_etfs_strategy()
    response = client.post(
        "/v2/canonical/strategies/perspectives",
        json=strategy.model_dump(mode="json"),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["schema_version"] == "ruletrade.dev/perspective-translation/v2"
    assert payload["capital_flow"]["schema_version"] == "ruletrade.dev/capital-flow-manifest/v2"
    assert payload["decision_logic"]["schema_version"] == "ruletrade.dev/decision-logic-manifest/v2"
    assert all(item["source_semantic_addresses"] for item in payload["capital_flow"]["nodes"])
    assert all(item["source_semantic_addresses"] for item in payload["decision_logic"]["blocks"])


def test_layout_cannot_participate_in_semantic_equivalence() -> None:
    strategy = strongest_etfs_strategy()
    assert semantically_equivalent(strategy, strategy.model_copy(deep=True))
    bundle = perspective_bundle(strategy)
    serialized = bundle.model_dump(mode="json")
    assert "position" not in json.dumps(serialized).lower()
    assert "viewport" not in json.dumps(serialized).lower()


def test_supported_edit_round_trips_through_validated_cas_and_reprojection() -> None:
    before = strongest_etfs_strategy()
    before_bundle = perspective_bundle(before)
    changed = apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=before,
        expected_source_hash=strategy_hash(before),
        operation=SetProgramFallback(
            kind="set_program_fallback", semantic_id="select-growth", fallback_asset="IEF",
        ),
    )).strategy
    after_bundle = perspective_bundle(changed)
    assert before_bundle.internal.semantic_fingerprint != after_bundle.internal.semantic_fingerprint
    assert next(item for item in after_bundle.capital_flow.nodes if item.role == "fallback").detail == "IEF"
    changed_fallback = next(
        item for item in after_bundle.decision_logic.blocks if item.role == "fallback"
    )
    assert changed_fallback.label.endswith("IEF")
    before_dump = before.model_dump(mode="json")
    after_dump = changed.model_dump(mode="json")
    before_selection = before_dump["program"]["statements"][0]["selection"]
    after_selection = after_dump["program"]["statements"][0]["selection"]
    assert {**before_selection, "fallback_asset": "IEF"} == after_selection


def test_reconciled_corpus_is_honest_about_all_ten_design_cases() -> None:
    path = Path(__file__).parents[1] / "corpus" / "perspective-translation-corpus.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert len(payload["cases"]) == 10
    assert {item["source_case"] for item in payload["cases"]} == {
        "single-qqq", "strongest-etfs", "growth-defensive", "sma-filter",
        "weighted-score", "nofm", "breakout-retest", "weekly-daily",
        "guard-override", "inverse-volatility",
    }
    inverse = next(item for item in payload["cases"] if item["id"] == "inverse-volatility")
    assert inverse["classification"] == "incomplete_reference_only"
    assert not inverse["backend_lowerable"]
    assert not inverse["ui_authorable"]
    assert "169 source records are fragments" in payload["evidence_boundary"]
    fixtures = json.loads((path.parent / "perspective-manifest-fixtures.json").read_text(encoding="utf-8"))
    assert len(fixtures["cases"]) == 10
    assert next(item for item in fixtures["cases"] if item["id"] == "strongest-etfs")["status"] == "verified"
