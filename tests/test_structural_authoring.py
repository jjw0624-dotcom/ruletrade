from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_strategy_service
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.ir.strategy import FilterOp
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.authoring import (
    AddFallbackSelectionOperation,
    AddQualificationConditionOperation,
    RemoveFallbackSelectionOperation,
    RemoveQualificationConditionOperation,
    RenameGroupOperation,
    StructuralAuthoringError,
    TransformToChooseAssetsOperation,
    TransformToGrowthDefensiveOperation,
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


def test_remove_fallback_reconnects_selection_and_removes_owned_definition() -> None:
    original = fallback_momentum_strategy()
    before = original.model_dump(mode="json")
    edited = apply_structural_operation(
        original,
        RemoveFallbackSelectionOperation(fallback_component_id="fallback"),
    )
    assert original.model_dump(mode="json") == before
    assert "fallback" not in _ids(edited)
    assert all(item.id != "fallback_tlt" for item in edited.definitions.asset_sets)
    assert any(
        item.source.component_id == "weights"
        and item.target.component_id == "rebalance"
        for item in edited.graph.connections
    )
    assert structural_authoring_capabilities(original).fallback_remove_targets == (
        "fallback",
    )
    assert structural_authoring_capabilities(edited).fallback_remove_targets == ()
    compile_strategy_to_lean_plan(edited)


def test_capabilities_match_starting_skeletons() -> None:
    one = structural_authoring_capabilities(one_investment_strategy())
    choose = structural_authoring_capabilities(momentum_top_n_strategy())
    split = structural_authoring_capabilities(portfolio_sleeves_strategy())
    assert not one.add_group and one.create_choose_pipeline
    assert one.choose_pipeline_targets == ("weights",)
    assert one.growth_defensive_targets == ("weights",)
    assert choose.qualification_add_targets == ("momentum_rank",)
    assert not choose.create_choose_pipeline
    assert not choose.multiple_qualification_conditions
    assert split.rename_group
    assert {item.component_id for item in split.groups} == {
        "growth_sleeve",
        "defensive_sleeve",
    }
    assert not split.add_group and not split.remove_group
    assert not split.transform_to_growth_defensive


def test_one_investment_evolves_through_supported_shapes_and_compiles() -> None:
    original = one_investment_strategy()
    original_payload = original.model_dump(mode="json")
    original_ids = set(_ids(original))

    choose = apply_structural_operation(
        original,
        TransformToChooseAssetsOperation(
            weight_component_id="weights",
            lookback_observations=63,
            count=1,
        ),
    )
    assert original.model_dump(mode="json") == original_payload
    assert original_ids < set(_ids(choose))
    assert {"weights_trailing_return", "weights_rank", "weights_top_n"} <= set(
        _ids(choose)
    )
    assert structural_authoring_capabilities(choose).qualification_add_targets == (
        "weights_rank",
    )

    filtered = apply_structural_operation(
        choose,
        AddQualificationConditionOperation(
            rank_component_id="weights_rank", threshold=Decimal("0.02")
        ),
    )
    with_fallback = apply_structural_operation(
        filtered,
        AddFallbackSelectionOperation(
            weight_component_id="weights", fallback_asset="tlt"
        ),
    )
    split = apply_structural_operation(
        with_fallback,
        TransformToGrowthDefensiveOperation(
            target_component_id="weights_fallback",
            growth_allocation=Decimal("0.65"),
            defensive_assets=("ief", "shy"),
        ),
    )

    assert original_ids < set(_ids(split))
    assert next(
        item
        for item in split.definitions.asset_sets
        if item.id == "weights_fallback_assets"
    ).assets == ["TLT"]
    assert next(
        item
        for item in split.definitions.asset_sets
        if item.id == "weights_fallback_defensive_assets"
    ).assets == ["IEF", "SHY"]
    assert next(
        item
        for item in split.graph.components
        if item.id == "weights_fallback_growth_sleeve"
    ).config["allocation"] == Decimal("0.65")
    assert next(
        item
        for item in split.graph.components
        if item.id == "weights_fallback_defensive_sleeve"
    ).config["allocation"] == Decimal("0.35")
    assert split.entrypoints == original.entrypoints
    plan = compile_strategy_to_lean_plan(split)
    source = generate_csharp(plan)
    assert plan.momentum_selections[0].filter_component_id == (
        "weights_rank_qualification"
    )
    assert '"filter_component", "weights_rank_qualification"' in source
    assert "weights_fallback_growth_sleeve" in source


def test_shape_transformations_are_deterministic_and_atomic() -> None:
    original = one_investment_strategy()
    operation = TransformToChooseAssetsOperation(
        weight_component_id="weights", lookback_observations=126, count=1
    )
    assert apply_structural_operation(original, operation) == apply_structural_operation(
        original, operation
    )
    before = original.model_dump(mode="json")
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            TransformToChooseAssetsOperation(
                weight_component_id="weights", lookback_observations=126, count=2
            ),
        )
    assert raised.value.code == "selection_count_exceeds_assets"
    assert original.model_dump(mode="json") == before


def test_fallback_and_split_only_target_unambiguous_owned_shapes() -> None:
    original = momentum_top_n_strategy()
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            AddFallbackSelectionOperation(
                weight_component_id="weights", fallback_asset="TLT"
            ),
        )
    assert raised.value.code == "unsupported_shape_transformation"

    split = apply_structural_operation(
        original,
        TransformToGrowthDefensiveOperation(
            target_component_id="weights",
            growth_allocation=Decimal("0.7"),
            defensive_assets=("TLT",),
        ),
    )
    assert structural_authoring_capabilities(split).growth_defensive_targets == ()
    assert _ids(split)[: len(_ids(original))] == _ids(original)
    compile_strategy_to_lean_plan(split)


def test_growth_defensive_rejects_duplicate_defensive_assets_atomically() -> None:
    original = one_investment_strategy()
    with pytest.raises(StructuralAuthoringError) as error:
        apply_structural_operation(
            original,
            TransformToGrowthDefensiveOperation(
                target_component_id="weights",
                growth_allocation=Decimal("0.6"),
                defensive_assets=("BIL", "bil"),
            ),
        )
    assert error.value.code == "duplicate_asset"
    assert original == one_investment_strategy()


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


def test_authoring_endpoint_exposes_and_applies_shape_grammar() -> None:
    strategy = one_investment_strategy().model_dump(mode="json")
    capabilities = client.post(
        "/v1/canonical/strategies/authoring/capabilities", json=strategy
    )
    assert capabilities.status_code == 200
    assert capabilities.json()["choose_pipeline_targets"] == ["weights"]
    assert capabilities.json()["growth_defensive_targets"] == ["weights"]

    operations = [
        {
            "kind": "transform_to_choose_assets",
            "weight_component_id": "weights",
            "lookback_observations": 63,
            "count": 1,
        },
        {
            "kind": "add_qualification_condition",
            "rank_component_id": "weights_rank",
            "threshold": "0.01",
        },
        {
            "kind": "add_fallback_selection",
            "weight_component_id": "weights",
            "fallback_asset": "TLT",
        },
        {
            "kind": "transform_to_growth_defensive",
            "target_component_id": "weights_fallback",
            "growth_allocation": "0.6",
            "defensive_assets": ["IEF"],
        },
    ]
    for operation in operations:
        response = client.post(
            "/v1/canonical/strategies/authoring/apply",
            json={"strategy": strategy, "operation": operation},
        )
        assert response.status_code == 200, response.text
        strategy = response.json()["strategy"]
    assert {item["config"].get("name") for item in strategy["graph"]["components"]} >= {
        "Growth",
        "Defensive",
    }


def test_structural_results_save_and_reopen_through_revision_api(
    tmp_path: Path,
) -> None:
    service = StrategyService(SQLiteStrategyRepository(tmp_path / "ruletrade.sqlite3"))
    app.dependency_overrides[get_strategy_service] = lambda: service
    try:
        with TestClient(app) as persisted_client:
            original = momentum_top_n_strategy()
            created = persisted_client.post(
                "/v1/strategies",
                json={
                    "name": "Authoring round trip",
                    "canonical_strategy": original.model_dump(mode="json"),
                },
            )
            assert created.status_code == 201
            strategy_id = created.json()["strategy"]["id"]
            first_revision_id = created.json()["current_revision"]["id"]

            capabilities = persisted_client.post(
                "/v1/canonical/strategies/authoring/capabilities",
                json=original.model_dump(mode="json"),
            )
            assert capabilities.status_code == 200
            assert capabilities.json()["qualification_add_targets"] == [
                "momentum_rank"
            ]

            added = persisted_client.post(
                "/v1/canonical/strategies/authoring/apply",
                json={
                    "strategy": original.model_dump(mode="json"),
                    "operation": {
                        "kind": "add_qualification_condition",
                        "rank_component_id": "momentum_rank",
                    },
                },
            )
            assert added.status_code == 200
            added_strategy = added.json()["strategy"]
            saved_add = persisted_client.post(
                f"/v1/strategies/{strategy_id}/revisions",
                json={
                    "expected_parent_revision_id": first_revision_id,
                    "canonical_strategy": added_strategy,
                },
            )
            assert saved_add.status_code == 201
            second_revision_id = saved_add.json()["revision"]["id"]
            reopened_add = persisted_client.get(f"/v1/strategies/{strategy_id}")
            assert reopened_add.status_code == 200
            assert (
                reopened_add.json()["current_revision"]["canonical_strategy"]
                == added_strategy
            )

            remove_capabilities = persisted_client.post(
                "/v1/canonical/strategies/authoring/capabilities",
                json=added_strategy,
            )
            assert remove_capabilities.status_code == 200
            assert remove_capabilities.json()["qualification_remove_targets"] == [
                "momentum_rank_qualification"
            ]
            removed = persisted_client.post(
                "/v1/canonical/strategies/authoring/apply",
                json={
                    "strategy": added_strategy,
                    "operation": {
                        "kind": "remove_qualification_condition",
                        "condition_component_id": "momentum_rank_qualification",
                    },
                },
            )
            assert removed.status_code == 200
            removed_strategy = removed.json()["strategy"]
            saved_remove = persisted_client.post(
                f"/v1/strategies/{strategy_id}/revisions",
                json={
                    "expected_parent_revision_id": second_revision_id,
                    "canonical_strategy": removed_strategy,
                },
            )
            assert saved_remove.status_code == 201
            reopened_remove = persisted_client.get(f"/v1/strategies/{strategy_id}")
            assert reopened_remove.status_code == 200
            assert (
                reopened_remove.json()["current_revision"]["canonical_strategy"]
                == removed_strategy
            )
            assert all(
                item["id"] != "momentum_rank_qualification"
                for item in removed_strategy["graph"]["components"]
            )
    finally:
        app.dependency_overrides.clear()
