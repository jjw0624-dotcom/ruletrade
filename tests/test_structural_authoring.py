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
    AddCooldownOperation,
    AddFallbackSelectionOperation,
    AddQualificationConditionOperation,
    RemoveCooldownOperation,
    RemoveFallbackSelectionOperation,
    RemoveQualificationConditionOperation,
    RenameGroupOperation,
    SleeveAllocationInput,
    StructuralAuthoringError,
    TransformToChooseAssetsOperation,
    TransformToGrowthDefensiveOperation,
    UpdateAssetSetOperation,
    UpdateCooldownDurationOperation,
    UpdateLookbackOperation,
    UpdateQualificationThresholdOperation,
    UpdateScheduleOperation,
    UpdateSelectionCountOperation,
    UpdateSleeveAllocationsOperation,
    apply_structural_operation,
    structural_authoring_capabilities,
)
from ruletrade.strategy.v1.fixtures import (
    cooldown_strategy,
    fallback_momentum_strategy,
    filter_screening_strategy,
    independent_schedules_strategy,
    momentum_top_n_strategy,
    one_investment_strategy,
    portfolio_sleeves_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1

client = TestClient(app)


def _ids(strategy: object) -> tuple[str, ...]:
    return tuple(item.id for item in strategy.graph.components)


def test_construct_and_remove_cooldown_on_top_n_pipeline() -> None:
    original = momentum_top_n_strategy()
    target = "top_n"
    assert target in structural_authoring_capabilities(original).cooldown_add_targets
    before = original.model_dump(mode="json")
    edited = apply_structural_operation(original, AddCooldownOperation(selection_component_id=target, duration=20))
    assert original.model_dump(mode="json") == before
    assert tuple(item for item in _ids(edited) if item != "top_n_cooldown") == _ids(original)
    assert target not in structural_authoring_capabilities(edited).cooldown_add_targets
    assert "top_n_cooldown" in structural_authoring_capabilities(edited).cooldown_remove_targets
    assert compile_strategy_to_lean_plan(edited).cooldown_states[0].required_completed_sessions == 20
    source = generate_csharp(compile_strategy_to_lean_plan(edited))
    assert '"cooldown_field", "config.duration"' in source
    restored = apply_structural_operation(edited, RemoveCooldownOperation(cooldown_component_id="top_n_cooldown"))
    assert restored == original

    with pytest.raises(StructuralAuthoringError):
        apply_structural_operation(edited, AddCooldownOperation(selection_component_id=target, duration=1))
    assert original.model_dump(mode="json") == before


def test_cooldown_capability_rejects_unsupported_selection_contexts() -> None:
    assert not structural_authoring_capabilities(one_investment_strategy()).cooldown_add_targets
    assert not structural_authoring_capabilities(fallback_momentum_strategy()).cooldown_add_targets
    with pytest.raises(StructuralAuthoringError) as error:
        apply_structural_operation(fallback_momentum_strategy(), AddCooldownOperation(selection_component_id="top_n", duration=10))
    assert error.value.code in {"unsupported_cooldown_structure", "component_not_found"}
    source = momentum_top_n_strategy().model_dump(mode="json")
    rejected = client.post("/v1/canonical/strategies/authoring/apply", json={
        "strategy": source, "operation": {
            "kind": "add_cooldown_to_selection", "selection_component_id": "top_n", "duration": 0,
        },
    })
    assert rejected.status_code == 422
    assert source == momentum_top_n_strategy().model_dump(mode="json")


def test_one_investment_construction_chain_persists_and_compiles(tmp_path: Path) -> None:
    service = StrategyService(SQLiteStrategyRepository(tmp_path / "construction.sqlite3"))
    app.dependency_overrides[get_strategy_service] = lambda: service
    try:
        with TestClient(app) as persisted_client:
            source = one_investment_strategy().model_dump(mode="json")
            created = persisted_client.post("/v1/strategies", json={
                "name": "Constructed strategy", "canonical_strategy": source,
            })
            assert created.status_code == 201
            strategy_id = created.json()["strategy"]["id"]
            revision_id = created.json()["current_revision"]["id"]
            operations = (
                {"kind": "update_asset_set", "asset_set_id": "investment", "assets": ["QQQ", "IEF"]},
                {"kind": "transform_to_choose_assets", "weight_component_id": "weights", "lookback_observations": 21, "count": 1},
                {"kind": "add_qualification_condition", "rank_component_id": "weights_rank"},
                {"kind": "add_cooldown_to_selection", "selection_component_id": "weights_top_n", "duration": 20},
            )
            for operation in operations:
                capabilities = persisted_client.post("/v1/canonical/strategies/authoring/capabilities", json=source)
                assert capabilities.status_code == 200
                if operation["kind"] == "add_cooldown_to_selection":
                    assert capabilities.json()["cooldown_add_targets"] == ["weights_top_n"]
                applied = persisted_client.post("/v1/canonical/strategies/authoring/apply", json={
                    "strategy": source, "operation": operation,
                })
                assert applied.status_code == 200, applied.text
                source = applied.json()["strategy"]
            assert "weights_top_n_cooldown" in (item["id"] for item in source["graph"]["components"])
            assert compile_strategy_to_lean_plan(CanonicalStrategyV1.model_validate(source)).cooldown_states[0].required_completed_sessions == 20
            saved = persisted_client.post(f"/v1/strategies/{strategy_id}/revisions", json={
                "expected_parent_revision_id": revision_id, "canonical_strategy": source,
            })
            assert saved.status_code == 201
            reopened = persisted_client.get(f"/v1/strategies/{strategy_id}")
            assert reopened.json()["current_revision"]["canonical_strategy"] == source
    finally:
        app.dependency_overrides.clear()


def test_rename_group_preserves_source_and_ids() -> None:
    original = portfolio_sleeves_strategy()
    before = original.model_dump(mode="json")
    edited = apply_structural_operation(
        original,
        RenameGroupOperation(group_component_id="growth_sleeve", name="  Opportunity  "),
    )
    assert original.model_dump(mode="json") == before
    assert _ids(edited) == _ids(original)
    assert (
        next(item for item in edited.graph.components if item.id == "growth_sleeve").config["name"]
        == "Opportunity"
    )
    compile_strategy_to_lean_plan(edited)


def test_rename_rejects_duplicate_atomically() -> None:
    original = portfolio_sleeves_strategy()
    before = original.model_dump(mode="json")
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            RenameGroupOperation(group_component_id="growth_sleeve", name="defensive"),
        )
    assert raised.value.code == "duplicate_group_name"
    assert original.model_dump(mode="json") == before


def test_add_condition_rewires_compiles_and_preserves_provenance() -> None:
    original = momentum_top_n_strategy()
    edited = apply_structural_operation(
        original,
        AddQualificationConditionOperation(rank_component_id="momentum_rank", threshold=Decimal("0.05")),
    )
    assert _ids(edited)[:-1] == _ids(original)
    assert _ids(edited)[-1] == "momentum_rank_qualification"
    operation = next(
        item for item in lower_strategy_model_to_ir(edited).operations if isinstance(item, FilterOp)
    )
    assert operation.provenance.component_id == "momentum_rank_qualification"
    plan = compile_strategy_to_lean_plan(edited)
    assert plan.momentum_selections[0].filter_component_id == ("momentum_rank_qualification")
    source = generate_csharp(plan)
    assert ".Where(item => item.Value > 0.05m)" in source
    assert '"filter_component", "momentum_rank_qualification"' in source


def test_condition_add_is_deterministic_and_single_only() -> None:
    original = momentum_top_n_strategy()
    operation = AddQualificationConditionOperation(rank_component_id="momentum_rank")
    assert apply_structural_operation(original, operation) == apply_structural_operation(original, operation)
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(filter_screening_strategy(), operation)
    assert raised.value.code == "qualification_condition_exists"


def test_remove_condition_reconnects_and_preserves_surviving_ids() -> None:
    original = filter_screening_strategy()
    edited = apply_structural_operation(
        original,
        RemoveQualificationConditionOperation(condition_component_id="positive_return"),
    )
    assert _ids(edited) == tuple(item for item in _ids(original) if item != "positive_return")
    assert any(
        item.source.component_id == "momentum" and item.target.component_id == "momentum_rank"
        for item in edited.graph.connections
    )
    assert not any(
        item.source.component_id == "positive_return" or item.target.component_id == "positive_return"
        for item in edited.graph.connections
    )
    assert compile_strategy_to_lean_plan(edited).momentum_selections[0].filter_component_id is None


def test_remove_filter_required_by_fallback_is_atomic() -> None:
    original = fallback_momentum_strategy()
    before = original.model_dump(mode="json")
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            RemoveQualificationConditionOperation(condition_component_id="positive_return"),
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
        item.source.component_id == "weights" and item.target.component_id == "rebalance"
        for item in edited.graph.connections
    )
    assert structural_authoring_capabilities(original).fallback_remove_targets == ("fallback",)
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
    assert {"weights_trailing_return", "weights_rank", "weights_top_n"} <= set(_ids(choose))
    assert structural_authoring_capabilities(choose).qualification_add_targets == ("weights_rank",)

    filtered = apply_structural_operation(
        choose,
        AddQualificationConditionOperation(rank_component_id="weights_rank", threshold=Decimal("0.02")),
    )
    with_fallback = apply_structural_operation(
        filtered,
        AddFallbackSelectionOperation(weight_component_id="weights", fallback_asset="tlt"),
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
        item for item in split.definitions.asset_sets if item.id == "weights_fallback_assets"
    ).assets == ["TLT"]
    assert next(
        item for item in split.definitions.asset_sets if item.id == "weights_fallback_defensive_assets"
    ).assets == ["IEF", "SHY"]
    assert next(
        item for item in split.graph.components if item.id == "weights_fallback_growth_sleeve"
    ).config["allocation"] == Decimal("0.65")
    assert next(
        item for item in split.graph.components if item.id == "weights_fallback_defensive_sleeve"
    ).config["allocation"] == Decimal("0.35")
    assert split.entrypoints == original.entrypoints
    plan = compile_strategy_to_lean_plan(split)
    source = generate_csharp(plan)
    assert plan.momentum_selections[0].filter_component_id == ("weights_rank_qualification")
    assert '"filter_component", "weights_rank_qualification"' in source
    assert "weights_fallback_growth_sleeve" in source


def test_shape_transformations_are_deterministic_and_atomic() -> None:
    original = one_investment_strategy()
    operation = TransformToChooseAssetsOperation(
        weight_component_id="weights", lookback_observations=126, count=1
    )
    assert apply_structural_operation(original, operation) == apply_structural_operation(original, operation)
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
            AddFallbackSelectionOperation(weight_component_id="weights", fallback_asset="TLT"),
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
    assert response.json()["strategy"]["graph"]["components"][-1]["id"] == ("momentum_rank_qualification")
    capabilities = client.post(
        "/v1/canonical/strategies/authoring/capabilities",
        json=portfolio_sleeves_strategy().model_dump(mode="json"),
    )
    assert capabilities.status_code == 200
    assert capabilities.json()["add_group"] is False
    assert capabilities.json()["rename_group"] is True


def test_authoring_endpoint_exposes_and_applies_shape_grammar() -> None:
    strategy = one_investment_strategy().model_dump(mode="json")
    capabilities = client.post("/v1/canonical/strategies/authoring/capabilities", json=strategy)
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


def test_typed_authoring_capabilities_are_exact_and_registry_backed() -> None:
    capabilities = structural_authoring_capabilities(filter_screening_strategy())
    assert capabilities.asset_set_targets[0].asset_set_id == "universe"
    assert capabilities.lookback_targets[0].minimum == 1
    assert capabilities.selection_count_targets[0].maximum == 4
    assert capabilities.qualification_threshold_targets[0].component_id == ("positive_return")
    assert {choice.cadence for choice in capabilities.schedule_targets[0].choices} == {
        "daily",
        "monthly",
        "quarterly",
    }


def test_typed_edits_are_atomic_preserve_identity_and_compile() -> None:
    original = filter_screening_strategy()
    before = original.model_dump(mode="json")
    edited = apply_structural_operation(
        original,
        UpdateAssetSetOperation(asset_set_id="universe", assets=("QQQ", "VGT", "IEF")),
    )
    edited = apply_structural_operation(
        edited, UpdateLookbackOperation(component_id="momentum", lookback_bars=63)
    )
    edited = apply_structural_operation(
        edited,
        UpdateQualificationThresholdOperation(component_id="positive_return", threshold=Decimal("0.03")),
    )
    edited = apply_structural_operation(edited, UpdateSelectionCountOperation(component_id="top_n", count=2))
    assert original.model_dump(mode="json") == before
    assert _ids(edited) == _ids(original)
    assert compile_strategy_to_lean_plan(edited).momentum_selections[0].lookback_bars == 63
    assert '"score_component", "momentum"' in generate_csharp(compile_strategy_to_lean_plan(edited))


def test_selection_count_rejects_more_than_owned_universe_atomically() -> None:
    original = filter_screening_strategy()
    before = original.model_dump(mode="json")
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(original, UpdateSelectionCountOperation(component_id="top_n", count=5))
    assert raised.value.code == "selection_count_exceeds_assets"
    assert original.model_dump(mode="json") == before


def test_asset_edit_cannot_leave_selection_count_above_universe() -> None:
    original = filter_screening_strategy()
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            UpdateAssetSetOperation(asset_set_id="universe", assets=("QQQ",)),
        )
    assert raised.value.code == "selection_count_exceeds_assets"
    assert len(original.definitions.asset_sets[0].assets) == 4


def test_schedule_switching_rebuilds_config_and_recovers_repeatedly() -> None:
    strategy = independent_schedules_strategy()
    original_ids = _ids(strategy)
    transitions = (
        ("daily", None, {}),
        ("monthly", 1, {"day": 1}),
        ("quarterly", 1, {"day": 1}),
        ("daily", None, {}),
        ("monthly", None, {"day": 1}),
    )
    for cadence, day, expected_config in transitions:
        strategy = apply_structural_operation(
            strategy,
            UpdateScheduleOperation(component_id="growth_monthly", cadence=cadence, day=day),
        )
        component = next(item for item in strategy.graph.components if item.id == "growth_monthly")
        assert component.primitive == f"{cadence}@1"
        assert component.config == expected_config
        assert _ids(strategy) == original_ids
        compile_strategy_to_lean_plan(strategy)


def test_cooldown_duration_is_existing_target_only_and_atomic() -> None:
    original = cooldown_strategy()
    edited = apply_structural_operation(
        original,
        UpdateCooldownDurationOperation(component_id="cooldown", duration=30),
    )
    assert next(item for item in edited.graph.components if item.id == "cooldown").config["duration"] == 30
    assert structural_authoring_capabilities(edited).cooldown_duration_targets[0].value == 30
    compile_strategy_to_lean_plan(edited)
    with pytest.raises(StructuralAuthoringError) as raised:
        apply_structural_operation(
            original,
            UpdateCooldownDurationOperation(component_id="top_n", duration=30),
        )
    assert raised.value.code == "unsupported_target"
    assert original == cooldown_strategy()


def test_sleeve_allocations_update_as_one_explicit_vector() -> None:
    original = portfolio_sleeves_strategy()
    edited = apply_structural_operation(
        original,
        UpdateSleeveAllocationsOperation(
            allocations=(
                SleeveAllocationInput(component_id="growth_sleeve", allocation=Decimal("0.6")),
                SleeveAllocationInput(component_id="defensive_sleeve", allocation=Decimal("0.4")),
            )
        ),
    )
    assert [
        item.config["allocation"]
        for item in edited.graph.components
        if item.primitive == "portfolio_sleeve@1"
    ] == [Decimal("0.6"), Decimal("0.4")]
    compile_strategy_to_lean_plan(edited)


def test_typed_authoring_api_rejects_invalid_input_without_source_mutation() -> None:
    source = cooldown_strategy().model_dump(mode="json")
    response = client.post(
        "/v1/canonical/strategies/authoring/apply",
        json={
            "strategy": source,
            "operation": {
                "kind": "update_cooldown_duration",
                "component_id": "cooldown",
                "duration": 0,
            },
        },
    )
    assert response.status_code == 422
    assert source == cooldown_strategy().model_dump(mode="json")


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
            assert capabilities.json()["qualification_add_targets"] == ["momentum_rank"]

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
            scheduled = persisted_client.post(
                "/v1/canonical/strategies/authoring/apply",
                json={
                    "strategy": added_strategy,
                    "operation": {
                        "kind": "update_schedule",
                        "component_id": "monthly",
                        "cadence": "daily",
                    },
                },
            )
            assert scheduled.status_code == 200
            added_strategy = scheduled.json()["strategy"]
            assert next(
                item for item in added_strategy["graph"]["components"] if item["id"] == "monthly"
            ) == {"id": "monthly", "primitive": "daily@1", "config": {}, "condition": None, "actions": []}
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
            assert reopened_add.json()["current_revision"]["canonical_strategy"] == added_strategy

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
            assert reopened_remove.json()["current_revision"]["canonical_strategy"] == removed_strategy
            assert all(
                item["id"] != "momentum_rank_qualification"
                for item in removed_strategy["graph"]["components"]
            )
    finally:
        app.dependency_overrides.clear()
