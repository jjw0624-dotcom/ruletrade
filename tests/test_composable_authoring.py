import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.strategy.v1.composition import (
    ComponentAddress,
    ComposeStrategyOperation,
    CompositionError,
    ConnectMutation,
    CreateAssetSetMutation,
    CreateComponentMutation,
    DisconnectMutation,
    PortAddress,
    SetComponentFieldMutation,
    apply_composition,
    composition_capabilities,
)
from ruletrade.strategy.v1.authoring import (
    AddCooldownOperation,
    AddFallbackSelectionOperation,
    RemoveCooldownOperation,
    RemoveFallbackSelectionOperation,
    RemoveQualificationConditionOperation,
    apply_structural_operation,
)
from ruletrade.strategy.v1.fixtures import momentum_top_n_strategy, one_investment_strategy

client = TestClient(app)


def _qualification_operation() -> ComposeStrategyOperation:
    return ComposeStrategyOperation(
        mutations=(
            DisconnectMutation(
                source=PortAddress(component_id="momentum", port="scores"),
                target=PortAddress(component_id="momentum_rank", port="scores"),
            ),
            CreateComponentMutation(
                ref="condition",
                primitive="filter@1",
                config={"operator": "gt", "threshold": "0"},
            ),
            ConnectMutation(
                source=PortAddress(component_id="momentum", port="scores"),
                target=PortAddress(created_ref="condition", port="scores"),
            ),
            ConnectMutation(
                source=PortAddress(created_ref="condition", port="scores"),
                target=PortAddress(component_id="momentum_rank", port="scores"),
            ),
        )
    )


def _metric_pipeline_operation() -> ComposeStrategyOperation:
    return ComposeStrategyOperation(
        mutations=(
            DisconnectMutation(
                source=PortAddress(component_id="investment_assets", port="assets"),
                target=PortAddress(component_id="weights", port="assets"),
            ),
            CreateComponentMutation(
                ref="metric", primitive="trailing_return@1", config={"lookback_bars": 126}
            ),
            CreateComponentMutation(
                ref="rank", primitive="rank@1", config={"direction": "descending"}
            ),
            CreateComponentMutation(ref="choose", primitive="top_n@1", config={"count": 1}),
            ConnectMutation(
                source=PortAddress(component_id="investment_assets", port="assets"),
                target=PortAddress(created_ref="metric", port="assets"),
            ),
            ConnectMutation(
                source=PortAddress(created_ref="metric", port="scores"),
                target=PortAddress(created_ref="rank", port="scores"),
            ),
            ConnectMutation(
                source=PortAddress(created_ref="rank", port="ranked"),
                target=PortAddress(created_ref="choose", port="ranked"),
            ),
            ConnectMutation(
                source=PortAddress(created_ref="choose", port="selected"),
                target=PortAddress(component_id="weights", port="assets"),
            ),
        )
    )


def test_composition_builds_metric_scaffold_then_accepts_independent_primitives() -> None:
    original = one_investment_strategy()
    metric = apply_composition(original, _metric_pipeline_operation())
    assert metric.created_component_ids == {
        "metric": "trailing_return",
        "rank": "rank",
        "choose": "top_n",
    }
    assert compile_strategy_to_lean_plan(metric.strategy).momentum_selections[0].lookback_bars == 126

    condition = apply_composition(
        metric.strategy,
        ComposeStrategyOperation(
            mutations=(
                DisconnectMutation(
                    source=PortAddress(component_id="trailing_return", port="scores"),
                    target=PortAddress(component_id="rank", port="scores"),
                ),
                CreateComponentMutation(
                    ref="condition", primitive="filter@1", config={"operator": "gt", "threshold": "0"}
                ),
                ConnectMutation(
                    source=PortAddress(component_id="trailing_return", port="scores"),
                    target=PortAddress(created_ref="condition", port="scores"),
                ),
                ConnectMutation(
                    source=PortAddress(created_ref="condition", port="scores"),
                    target=PortAddress(component_id="rank", port="scores"),
                ),
            )
        ),
    )
    assert condition.created_component_ids == {"condition": "filter"}
    assert compile_strategy_to_lean_plan(condition.strategy).momentum_selections[0].filter_threshold == 0

    fallback = apply_structural_operation(
        condition.strategy,
        AddFallbackSelectionOperation(weight_component_id="weights", fallback_asset="TLT"),
    )
    assert compile_strategy_to_lean_plan(fallback).target_sleeves[0].fallback_symbols == ("TLT",)

    without_fallback = apply_structural_operation(
        fallback, RemoveFallbackSelectionOperation(fallback_component_id="weights_fallback")
    )
    cooldown = apply_structural_operation(
        without_fallback,
        AddCooldownOperation(selection_component_id="top_n", duration=10),
    )
    assert compile_strategy_to_lean_plan(cooldown).cooldown_states[0].required_completed_sessions == 10
    without_cooldown = apply_structural_operation(
        cooldown, RemoveCooldownOperation(cooldown_component_id="top_n_cooldown")
    )
    restored_metric = apply_structural_operation(
        without_cooldown, RemoveQualificationConditionOperation(condition_component_id="filter")
    )
    assert compile_strategy_to_lean_plan(restored_metric).momentum_selections[0].filter_threshold is None


def test_composition_creates_backend_owned_component_and_compiles() -> None:
    original = momentum_top_n_strategy()
    result = apply_composition(original, _qualification_operation())

    assert original == momentum_top_n_strategy()
    assert result.created_component_ids == {"condition": "filter"}
    assert any(item.id == "filter" for item in result.strategy.graph.components)
    plan = compile_strategy_to_lean_plan(result.strategy)
    assert plan.momentum_selections[0].filter_threshold == 0


def test_composition_rejects_invalid_final_graph_atomically() -> None:
    original = momentum_top_n_strategy()
    before = original.model_dump(mode="json")
    invalid = ComposeStrategyOperation(
        mutations=(
            DisconnectMutation(
                source=PortAddress(component_id="momentum", port="scores"),
                target=PortAddress(component_id="momentum_rank", port="scores"),
            ),
        )
    )

    with pytest.raises(CompositionError, match="invalid"):
        apply_composition(original, invalid)
    assert original.model_dump(mode="json") == before


def test_composition_checks_typed_ports_before_final_validation() -> None:
    invalid = ComposeStrategyOperation(
        mutations=(
            ConnectMutation(
                source=PortAddress(component_id="momentum", port="scores"),
                target=PortAddress(component_id="weights", port="assets"),
            ),
        )
    )

    with pytest.raises(CompositionError) as error:
        apply_composition(momentum_top_n_strategy(), invalid)
    assert error.value.code == "incompatible_ports"


def test_capabilities_expose_executable_primitives_but_not_effect_creation() -> None:
    capabilities = {item.primitive: item for item in composition_capabilities().primitives}
    assert capabilities["filter@1"].create_supported is True
    assert capabilities["rebalance@1"].create_supported is False
    assert composition_capabilities().incomplete_working_states is False


def test_authoring_api_returns_authoritative_strategy_and_created_id_map() -> None:
    response = client.post(
        "/v1/canonical/strategies/authoring/apply",
        json={
            "strategy": momentum_top_n_strategy().model_dump(mode="json"),
            "operation": _qualification_operation().model_dump(mode="json"),
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["created_component_ids"] == {"condition": "filter"}
    assert any(item["id"] == "filter" for item in response.json()["strategy"]["graph"]["components"])


def test_unknown_component_address_is_rejected_without_guessing() -> None:
    operation = ComposeStrategyOperation(
        mutations=(
            CreateComponentMutation(
                ref="condition",
                primitive="filter@1",
                config={"operator": "gt", "threshold": "0"},
            ),
            ConnectMutation(
                source=PortAddress(component_id="missing", port="scores"),
                target=PortAddress(created_ref="condition", port="scores"),
            ),
        )
    )
    with pytest.raises(CompositionError) as error:
        apply_composition(momentum_top_n_strategy(), operation)
    assert error.value.code == "component_not_found"


def test_component_address_requires_exactly_one_identity() -> None:
    with pytest.raises(ValueError):
        ComponentAddress()


def test_composition_builds_exact_two_sleeve_portfolio_and_compiles() -> None:
    original = momentum_top_n_strategy()
    operation = ComposeStrategyOperation(
        mutations=(
            DisconnectMutation(
                source=PortAddress(component_id="weights", port="targets"),
                target=PortAddress(component_id="rebalance", port="targets"),
            ),
            CreateComponentMutation(
                ref="growth_sleeve",
                primitive="portfolio_sleeve@1",
                config={"name": "Growth", "allocation": "0.7"},
            ),
            ConnectMutation(
                source=PortAddress(component_id="weights", port="targets"),
                target=PortAddress(created_ref="growth_sleeve", port="local_targets"),
            ),
            CreateAssetSetMutation(ref="defensive_assets", assets=("TLT",)),
            CreateComponentMutation(ref="defensive_universe", primitive="asset_set@1", config={}),
            SetComponentFieldMutation(
                target=ComponentAddress(created_ref="defensive_universe"),
                field="asset_set_ref",
                created_asset_set_ref="defensive_assets",
            ),
            CreateComponentMutation(
                ref="defensive_weight", primitive="equal_weight@1", config={"total": "1"}
            ),
            ConnectMutation(
                source=PortAddress(created_ref="defensive_universe", port="assets"),
                target=PortAddress(created_ref="defensive_weight", port="assets"),
            ),
            CreateComponentMutation(
                ref="defensive_sleeve",
                primitive="portfolio_sleeve@1",
                config={"name": "Defensive", "allocation": "0.3"},
            ),
            ConnectMutation(
                source=PortAddress(created_ref="defensive_weight", port="targets"),
                target=PortAddress(created_ref="defensive_sleeve", port="local_targets"),
            ),
            CreateComponentMutation(ref="portfolio", primitive="portfolio@1", config={"name": "Portfolio"}),
            ConnectMutation(
                source=PortAddress(created_ref="growth_sleeve", port="contribution"),
                target=PortAddress(created_ref="portfolio", port="sleeves"),
            ),
            ConnectMutation(
                source=PortAddress(created_ref="defensive_sleeve", port="contribution"),
                target=PortAddress(created_ref="portfolio", port="sleeves"),
            ),
            ConnectMutation(
                source=PortAddress(created_ref="portfolio", port="targets"),
                target=PortAddress(component_id="rebalance", port="targets"),
            ),
        )
    )

    result = apply_composition(original, operation)
    assert result.created_component_ids["portfolio"] == "portfolio"
    assert result.created_asset_set_ids["defensive_assets"] == "assets"
    plan = compile_strategy_to_lean_plan(result.strategy)
    assert len(plan.target_sleeves) == 2
    assert {item.source_sleeve_component_id for item in plan.target_sleeves} == {
        result.created_component_ids["growth_sleeve"],
        result.created_component_ids["defensive_sleeve"],
    }
