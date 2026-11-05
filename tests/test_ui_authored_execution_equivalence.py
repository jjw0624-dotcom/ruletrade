from __future__ import annotations

import json
from pathlib import Path

from pydantic import TypeAdapter

from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.strategy.v2.authoring import ApplyV2AuthoringRequest, V2AuthoringOperation, apply_v2_authoring, create_program_strategy_template, ProgramStrategyTemplateRequest
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.v2.validation import validate_strategy_v2
from ruletrade.hashing import strategy_hash


ROOT = Path(__file__).resolve().parents[1]


def test_guide_authored_monthly_qqq_matches_execution_fixture() -> None:
    fixture = json.loads((ROOT / "corpus/ui-authored-execution-equivalence.json").read_text(encoding="utf-8"))["case"]
    source = create_program_strategy_template(ProgramStrategyTemplateRequest(name="UI Authored Monthly QQQ"))
    operation = TypeAdapter(V2AuthoringOperation).validate_python(fixture["operation"])
    authored = apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=source,
        expected_source_hash=strategy_hash(source),
        operation=operation,
    )).strategy

    expected = CanonicalStrategyV2.model_validate(fixture["expected_canonical"])
    assert authored == expected
    assert validate_strategy_v2(authored) == ()

    capability = assess_v2_execution_capability(authored)
    expected_capability = fixture["expected_capability"]
    for field, value in expected_capability.items():
        assert getattr(capability, field) == value

    plan = compile_v2_strategy_to_lean_plan(authored)
    assert [subscription.symbol for subscription in plan.subscriptions] == ["QQQ"]
    assert len(plan.monthly_events) == 1
    assert plan.target_sleeves[0].symbols == ("QQQ",)
    source_code = generate_csharp(plan)
    assert 'SetHoldings(target.Key, target.Value)' in source_code
    assert '"final_targets"' in source_code
