from __future__ import annotations

from decimal import Decimal

import pytest

from ruletrade.hashing import semantic_payload, strategy_hash
from ruletrade.strategy.v2.authoring import (
    AddProgramGroup,
    ApplyV2AuthoringRequest,
    CreateProgramChoose,
    ProgramStrategyTemplateRequest,
    RemoveProgramGroup,
    RemoveProgramInvestmentAllocation,
    RenameProgramSubgroup,
    SetProgramAssetSet,
    SetProgramInvestment,
    V2AuthoringError,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    CanonicalStrategyV2,
    SelectionStatementV2,
)


def authored(strategy: CanonicalStrategyV2, operation):
    return apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=strategy,
        expected_source_hash=strategy_hash(strategy),
        operation=operation,
    )).strategy


def group_strategy() -> CanonicalStrategyV2:
    strategy = create_program_strategy_template(ProgramStrategyTemplateRequest(name="Separated authoring"))
    return authored(strategy, AddProgramGroup(
        kind="add_program_group", group_id="growth", name="Growth candidates",
        asset_set_id="growth-assets", assets=("QQQ", "VGT", "SOXX", "SCHG"),
    ))


def chosen_strategy() -> CanonicalStrategyV2:
    return authored(group_strategy(), CreateProgramChoose(
        kind="create_program_choose", semantic_id="choose-growth", group_id="growth",
        output_id="strongest-growth", clock_id="daily-close", lookback=126,
        direction="descending", count=2, shortage_policy="require_full",
        qualification_lookback=126, qualification_operator="gt",
        qualification_threshold=Decimal(0),
    ))


def test_group_and_choose_do_not_fabricate_capital_exposure() -> None:
    grouped = group_strategy()
    assert [group.id for group in grouped.definitions.groups] == ["growth"]
    assert not any(
        isinstance(statement, AllocationStatementV2)
        for statement in grouped.program.statements
        if statement.semantic_id != "initial-retain-allocation"
    )

    chosen = chosen_strategy()
    choose = next(item for item in chosen.program.statements if isinstance(item, SelectionStatementV2))
    assert choose.selection.universe_id == "growth"
    assert choose.output_id == "strongest-growth"
    assert not any(
        isinstance(statement, AllocationStatementV2)
        for statement in chosen.program.statements
        if statement.semantic_id != "initial-retain-allocation"
    )


def test_investment_connect_disconnect_preserves_group_and_subgroup() -> None:
    chosen = chosen_strategy()
    invested = authored(chosen, SetProgramInvestment(
        kind="set_program_investment", semantic_id="growth-investment",
        target_kind="selection", target_ref="strongest-growth",
        internal_allocation="equal", clock_id="daily-close",
    ))
    allocation = next(item for item in invested.program.statements if item.semantic_id == "growth-investment")
    assert isinstance(allocation, AllocationStatementV2)
    assert allocation.legs[0].target.kind == "selection"
    assert allocation.legs[0].target.ref == "strongest-growth"

    disconnected = authored(invested, RemoveProgramInvestmentAllocation(
        kind="remove_program_investment_allocation", semantic_id="growth-investment",
    ))
    assert any(isinstance(item, SelectionStatementV2) for item in disconnected.program.statements)
    assert disconnected.definitions.groups == chosen.definitions.groups


def test_membership_allocation_and_capital_target_mutate_independently() -> None:
    invested = authored(chosen_strategy(), SetProgramInvestment(
        kind="set_program_investment", semantic_id="growth-investment",
        target_kind="selection", target_ref="strongest-growth",
        internal_allocation="equal", clock_id="daily-close",
    ))
    allocation_before = next(item for item in invested.program.statements if item.semantic_id == "growth-investment")

    membership_changed = authored(invested, SetProgramAssetSet(
        kind="set_program_asset_set", asset_set_id="growth-assets",
        assets=("QQQ", "VGT", "SOXX"),
    ))
    assert next(item for item in membership_changed.program.statements if item.semantic_id == "growth-investment") == allocation_before

    renamed = authored(membership_changed, RenameProgramSubgroup(
        kind="rename_program_subgroup", semantic_id="choose-growth",
        output_id="leaders",
    ))
    selection = next(item for item in renamed.program.statements if isinstance(item, SelectionStatementV2))
    allocation = next(item for item in renamed.program.statements if item.semantic_id == "growth-investment")
    assert selection.output_id == "leaders"
    assert allocation.legs[0].target.ref == "leaders"
    assert allocation.method == "equal"


def test_group_dependency_errors_are_typed_and_save_reopen_is_stable() -> None:
    chosen = chosen_strategy()
    with pytest.raises(V2AuthoringError) as in_use:
        authored(chosen, RemoveProgramGroup(kind="remove_program_group", group_id="growth"))
    assert in_use.value.code == "group_in_use_by_choose"

    reopened = CanonicalStrategyV2.model_validate_json(chosen.model_dump_json())
    assert semantic_payload(reopened) == semantic_payload(chosen)
    assert strategy_hash(reopened) == strategy_hash(chosen)


def test_authoring_cas_still_rejects_stale_group_operation() -> None:
    source = create_program_strategy_template(ProgramStrategyTemplateRequest(name="CAS"))
    with pytest.raises(V2AuthoringError) as stale:
        apply_v2_authoring(ApplyV2AuthoringRequest(
            strategy=source, expected_source_hash="sha256:stale",
            operation=AddProgramGroup(
                kind="add_program_group", group_id="growth", name="Growth",
                asset_set_id="growth-assets", assets=("QQQ",),
            ),
        ))
    assert stale.value.code == "stale_authoring_source"
