from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from pydantic import TypeAdapter

from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.hashing import semantic_payload, strategy_hash
from ruletrade.strategy.v2.authoring import (
    ApplyV2AuthoringRequest,
    ProgramStrategyTemplateRequest,
    V2AuthoringOperation,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.v2.validation import validate_strategy_v2


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "corpus" / "advanced-ui-authored-execution-equivalence.json"


def cases() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def test_advanced_ui_equivalence_fixture_is_current() -> None:
    subprocess.run(
        [sys.executable, "scripts/build_advanced_ui_equivalence.py", "--check"],
        cwd=ROOT,
        check=True,
        env={**os.environ, "PYTHONPATH": "src"},
    )


def test_advanced_ui_operations_match_backend_semantics_and_execution() -> None:
    assert {case["id"] for case in cases()} == {
        "weighted_score",
        "temporal_sequence",
        "multi_clock_policy",
    }
    source = create_program_strategy_template(
        ProgramStrategyTemplateRequest(name="Advanced UI Authored")
    )
    for case in cases():
        operation = TypeAdapter(V2AuthoringOperation).validate_python(case["operation"])
        authored = apply_v2_authoring(
            ApplyV2AuthoringRequest(
                strategy=source,
                expected_source_hash=strategy_hash(source),
                operation=operation,
            )
        ).strategy
        expected = CanonicalStrategyV2.model_validate(case["expected_canonical"])
        assert authored.model_dump(mode="json") == case["expected_canonical"]
        assert validate_strategy_v2(expected) == ()
        assert validate_strategy_v2(authored) == ()
        assert assess_v2_execution_capability(authored).execution_state == "executable"

        reopened = CanonicalStrategyV2.model_validate_json(authored.model_dump_json())
        assert semantic_payload(reopened) == semantic_payload(authored)
        assert strategy_hash(reopened) == strategy_hash(authored)

        plan = compile_v2_strategy_to_lean_plan(reopened)
        generated = generate_csharp(plan)
        assert "public class RuleTradeGeneratedAlgorithm : QCAlgorithm" in generated
        if case["id"] == "weighted_score":
            assert '"final_targets"' in generated
        else:
            assert '"state_transition"' in generated
            assert "ruletrade-temporal-checkpoint@1" in generated


def test_advanced_cases_keep_their_distinct_execution_contracts() -> None:
    by_id = {
        case["id"]: CanonicalStrategyV2.model_validate(case["expected_canonical"])
        for case in cases()
    }
    weighted = by_id["weighted_score"]
    temporal = by_id["temporal_sequence"]
    multi = by_id["multi_clock_policy"]

    assert [clock.timeframe for clock in weighted.program.clocks] == ["monthly"]
    assert weighted.program.statements[-1].kind == "allocate"
    assert weighted.program.statements[-1].method == "proportional_score"

    assert temporal.program.initial_state == {"phase": "idle"}
    assert [statement.kind for statement in temporal.program.statements].count("on_event") == 4
    assert temporal.program.statements[-1].kind == "guarded_allocation"

    assert {clock.timeframe for clock in multi.program.clocks} == {"daily", "weekly"}
    assert multi.program.statements[-1].kind == "guarded_allocation"
    assert multi.program.statements[-1].unknown_guard_policy == "block"
