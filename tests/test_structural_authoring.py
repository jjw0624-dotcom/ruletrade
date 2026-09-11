from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.ir.strategy import FilterOp
from ruletrade.strategy.v1.authoring import (
    AddQualificationConditionOperation,
    RemoveQualificationConditionOperation,
    RenameGroupOperation,
    StructuralAuthoringError,
    apply_structural_operation,
    structural_authoring_capabilities,
)
from ruletrade.strategy.v1.fixtures import (
    fallback_momentum_strategy,
    filter_screening_strategy,
    momentum_top_n_strategy,
    one_investment_strategy,
    portfolio_sleeves_strategy,
)

client = TestClient(app)


def _ids(strategy: object) -> tuple[str, ...]:
    return tuple(item.id for item in strategy.graph.components)


def test_rename_group_preserves_source_and_ids() -> None:
    original = portfolio_sleeves_strategy()
    before = original.model_dump(mode="json")
    edited = apply_structural_operation(
        original,
        RenameGroupOperation(
            group_component_id="growth_sleeve", name="  Opportunity  "
        ),
    )
    assert original.model_dump(mode="json") == before
    assert _ids(edited) == _ids(original)
    assert next(
        item for item in edited.graph.components if item.id == "growth_sleeve"
    ).config["name"] == "Opportunity"
    compile_strategy_to_lean_plan(edited)


def test_rename_rejects_duplicate_atomically() -> None:
    original = portfolio_sleeves_strategy()
    before = original.model_dump(mode="json")
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            RenameGroupOperation(
                group_component_id="growth_sleeve", name="defensive"
            ),
        )
    assert raised.value.code == "duplicate_group_name"
    assert original.model_dump(mode="json") == before


def test_add_condition_rewires_compiles_and_preserves_provenance() -> None:
    original = momentum_top_n_strategy()
    edited = apply_structural_operation(
        original,
        AddQualificationConditionOperation(
            rank_component_id="momentum_rank", threshold=Decimal("0.05")
        ),
    )
    assert _ids(edited)[:-1] == _ids(original)
    assert _ids(edited)[-1] == "momentum_rank_qualification"
    operation = next(
        item
        for item in lower_strategy_model_to_ir(edited).operations
        if isinstance(item, FilterOp)
    )
    assert operation.provenance.component_id == "momentum_rank_qualification"
    plan = compile_strategy_to_lean_plan(edited)
    assert plan.momentum_selections[0].filter_component_id == (
        "momentum_rank_qualification"
    )
    source = generate_csharp(plan)
    assert ".Where(item => item.Value > 0.05m)" in source
    assert '"filter_component", "momentum_rank_qualification"' in source


def test_condition_add_is_deterministic_and_single_only() -> None:
    original = momentum_top_n_strategy()
    operation = AddQualificationConditionOperation(
        rank_component_id="momentum_rank"
    )
    assert apply_structural_operation(
        original, operation
    ) == apply_structural_operation(original, operation)
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(filter_screening_strategy(), operation)
    assert raised.value.code == "qualification_condition_exists"


def test_remove_condition_reconnects_and_preserves_surviving_ids() -> None:
    original = filter_screening_strategy()
    edited = apply_structural_operation(
        original,
        RemoveQualificationConditionOperation(
            condition_component_id="positive_return"
        ),
    )
    assert _ids(edited) == tuple(
        item for item in _ids(original) if item != "positive_return"
    )
    assert any(
        item.source.component_id == "momentum"
        and item.target.component_id == "momentum_rank"
        for item in edited.graph.connections
    )
    assert not any(
        item.source.component_id == "positive_return"
        or item.target.component_id == "positive_return"
        for item in edited.graph.connections
    )
    assert compile_strategy_to_lean_plan(
        edited
    ).momentum_selections[0].filter_component_id is None


def test_remove_filter_required_by_fallback_is_atomic() -> None:
    original = fallback_momentum_strategy()
    before = original.model_dump(mode="json")
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            RemoveQualificationConditionOperation(
                condition_component_id="positive_return"
            ),
        )
    assert raised.value.code == "result_invalid"
    assert original.model_dump(mode="json") == before


def test_capabilities_match_starting_skeletons() -> None:
    one = structural_authoring_capabilities(one_investment_strategy())
    choose = structural_authoring_capabilities(momentum_top_n_strategy())
    split = structural_authoring_capabilities(portfolio_sleeves_strategy())
    assert not one.add_group and not one.create_choose_pipeline
    assert choose.qualification_add_targets == ("momentum_rank",)
    assert not choose.multiple_qualification_conditions
    assert split.rename_group
    assert {item.component_id for item in split.groups} == {
        "growth_sleeve",
        "defensive_sleeve",
    }
    assert not split.add_group and not split.remove_group


def test_authoring_endpoints_apply_and_expose_narrow_capabilities() -> None:
    strategy = momentum_top_n_strategy()
    response = client.post(
        "/v1/canonical/strategies/authoring/apply",
        json={
            "strategy": strategy.model_dump(mode="json"),
            "operation": {
                "kind": "add_qualification_condition",
                "rank_component_id": "momentum_rank",
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["strategy"]["graph"]["components"][-1]["id"] == (
        "momentum_rank_qualification"
    )
    capabilities = client.post(
        "/v1/canonical/strategies/authoring/capabilities",
        json=portfolio_sleeves_strategy().model_dump(mode="json"),
    )
    assert capabilities.status_code == 200
    assert capabilities.json()["add_group"] is False
    assert capabilities.json()["rename_group"] is True
