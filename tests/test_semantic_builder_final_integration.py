from __future__ import annotations

from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.authoring import (
    AddProgramInvestment,
    ApplyV2AuthoringRequest,
    CreateProgramSelection,
    CreateProgramEventState,
    ProgramStrategyTemplateRequest,
    SetProgramSplit,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.corpus import (
    composable_semantic_execution_strategy,
    composable_split_execution_strategy,
)
from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability
from ruletrade.strategy.v2.projections import projection_bundle


client = TestClient(app)


def test_blank_projection_endpoint_is_independent_from_production_lowering() -> None:
    blank = create_program_strategy_template(ProgramStrategyTemplateRequest(name="Untitled Strategy"))
    response = client.post(
        "/v2/canonical/strategies/semantic-projections",
        json=blank.model_dump(mode="json"),
    )
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["projections"]) == {"structure", "flow", "blocky", "rules", "summary"}
    assert all(item["semantic_valid"] for item in payload["projections"].values())
    assert all(item["execution_claim"] == "incomplete" for item in payload["projections"].values())
    assert "lowering" not in str(payload).lower()


def test_composable_projection_contracts_are_distinct_and_addressable() -> None:
    strategy = composable_semantic_execution_strategy()
    bundle = projection_bundle(strategy)
    assert assess_v2_execution_capability(strategy).execution_state == "executable"
    assert all(item.execution_claim == "supported" for item in bundle.values())

    structure_roles = {item.role for item in bundle["structure"].items}
    blocky_roles = {item.role for item in bundle["blocky"].items}
    assert "assets" in structure_roles
    assert "assets" not in blocky_roles
    assert {"event", "transition", "memory", "policy", "selection", "value"} <= blocky_roles
    assert all(item.parent_id is None for item in bundle["rules"].items)
    assert len(bundle["summary"].items) == 1


def test_independent_sleeves_project_parallel_capital_and_reconvergence() -> None:
    strategy = composable_split_execution_strategy()
    bundle = projection_bundle(strategy)
    structure = bundle["structure"]
    flow = bundle["flow"]
    assert "split" in {item.role for item in structure.items}
    assert sum(item.role == "investment" for item in structure.items) == 2
    assert assess_v2_execution_capability(strategy).execution_state == "executable"
    capital_links = {(item.source_id, item.target_id, item.route) for item in flow.links}
    split = next(item for item in flow.items if item.role == "split")
    investments = [item for item in flow.items if item.role == "investment"]
    assert all((split.id, item.id, "capital") in capital_links for item in investments)
    selections = [item for item in flow.items if item.role == "selection"]
    assert len(selections) == 2


def test_nested_logic_projection_keeps_condition_and_value_composition() -> None:
    blocky = projection_bundle(composable_semantic_execution_strategy())["blocky"]
    conditions = [item for item in blocky.items if item.role == "condition"]
    values = [item for item in blocky.items if item.role == "value"]
    assert any(item.parent_id and item.parent_id.startswith("blocky:condition:") for item in conditions + values)
    assert any(item.label == "Score · weighted terms" for item in values)
    # Several view nodes may intentionally point at different fields of the
    # same semantic object (for example a Selection and its fallback).  The
    # rendered node identity must be unique while the shared semantic address
    # remains stable for cross-view selection.
    assert len({item.id for item in blocky.items}) == len(blocky.items)
    assert all(item.address.semantic_id for item in blocky.items)


def test_event_state_authoring_is_one_validated_atomic_operation() -> None:
    blank = create_program_strategy_template(ProgramStrategyTemplateRequest(name="Temporal"))
    invested = apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=blank,
        expected_source_hash=strategy_hash(blank),
        operation=AddProgramInvestment(
            kind="add_program_investment", investment_id="investment", name="Investment",
            asset_set_id="investment-assets", assets=("QQQ",),
        ),
    )).strategy
    authored = apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=invested,
        expected_source_hash=strategy_hash(invested),
        operation=CreateProgramEventState(
            kind="create_program_event_state", semantic_id="risk-on",
            clock_id="daily-close", asset="QQQ", threshold=0,
            state_key="regime", from_value="waiting", to_value="active",
        ),
    )).strategy
    assert authored.program is not None
    assert authored.program.initial_state == {"regime": "waiting"}
    event = authored.program.statements[-1]
    assert event.kind == "on_event"
    assert event.statements[0].kind == "transition"
    blocky_roles = {item.role for item in projection_bundle(authored)["blocky"].items}
    assert {"event", "transition", "condition", "value"} <= blocky_roles


def test_builder_operations_resolve_two_sleeves_to_one_honest_split() -> None:
    strategy = create_program_strategy_template(ProgramStrategyTemplateRequest(name="Two sleeves"))

    def authored(operation):
        nonlocal strategy
        strategy = apply_v2_authoring(ApplyV2AuthoringRequest(
            strategy=strategy,
            expected_source_hash=strategy_hash(strategy),
            operation=operation,
        )).strategy

    authored(AddProgramInvestment(
        kind="add_program_investment", investment_id="growth", name="Growth",
        asset_set_id="growth-assets", assets=("QQQ", "VGT"),
    ))
    authored(AddProgramInvestment(
        kind="add_program_investment", investment_id="defense", name="Defensive",
        asset_set_id="defense-assets", assets=("TLT", "IEF"),
    ))
    for semantic_id, investment_id in (("select-growth", "growth"), ("select-defense", "defense")):
        authored(CreateProgramSelection(
            kind="create_program_selection", semantic_id=semantic_id,
            investment_id=investment_id, clock_id="daily-close", lookback=21,
            direction="descending", count=1, shortage_policy="choose_all",
        ))
    authored(SetProgramSplit(
        kind="set_program_split",
        investments=(("growth", "0.6"), ("defense", "0.4")),
    ))

    assert strategy.program is not None
    allocations = [item for item in strategy.program.statements if item.kind == "allocate"]
    split = next(item for item in allocations if len(item.legs) == 2)
    assert [leg.target.kind for leg in split.legs] == ["selection", "selection"]
    assert not [item for item in allocations if len(item.legs) == 1 and item.semantic_id != "initial-retain-allocation"]
    capability = assess_v2_execution_capability(strategy)
    assert capability.execution_state == "executable"
    assert capability.technical_detail is None
    assert "split" in {item.role for item in projection_bundle(strategy)["structure"].items}
