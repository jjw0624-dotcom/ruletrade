import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.strategy.v1.composition import (
    ComponentAddress,
    ComposeStrategyOperation,
    CompositionError,
    ConnectMutation,
    CreateComponentMutation,
    DisconnectMutation,
    PortAddress,
    apply_composition,
    composition_capabilities,
)
from ruletrade.strategy.v1.fixtures import momentum_top_n_strategy

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
