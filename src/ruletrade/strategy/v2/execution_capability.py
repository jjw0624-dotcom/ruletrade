"""Product execution capability for committed SemanticProgramV2 documents.

This boundary deliberately runs before production lowering.  A valid authoring
document may be incomplete without being a compiler error.
"""
from __future__ import annotations

from typing import Literal

from ruletrade.strategy.v2.bridge import V2LoweringError, compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    CanonicalStrategyV2,
    GuardedAllocationStatementV2,
    ProgramStatementV2,
    SelectionStatementV2,
    UnresolvedStatementV2,
)
from ruletrade.strategy.v2.validation import validate_strategy_v2
from ruletrade.strategy.v2.semantic_types import FrozenModel


class V2ExecutionCapability(FrozenModel):
    # ``drafting`` is used by the client while an operation is unfinished; only
    # empty or committed documents cross this canonical API boundary.
    authoring_state: Literal["empty", "drafting", "committed"]
    semantic_state: Literal["valid", "invalid"]
    execution_state: Literal["incomplete", "unsupported", "executable"]
    provider_state: Literal["not_checked", "available", "unavailable"] = "not_checked"
    runtime_state: Literal["not_checked", "available", "unavailable"] = "not_checked"
    product_message: str
    technical_detail: str | None = None
    required_symbols: tuple[str, ...] = ()

    # Transitional fields retained for existing API consumers.  Their values are
    # derived from the typed states above, never from exception-message parsing.
    authorable: bool = True
    reference_valid: bool
    backend_lowerable: bool
    production_executable: bool
    reason: str | None = None


def _statements(items: tuple[ProgramStatementV2, ...]) -> tuple[ProgramStatementV2, ...]:
    result: list[ProgramStatementV2] = []
    for item in items:
        result.append(item)
        if item.kind == "control":
            result.extend(_statements(item.then_statements))
            result.extend(_statements(item.otherwise_statements))
        elif item.kind == "on_event":
            result.extend(_statements(item.statements))
    return tuple(result)


def _result(
    strategy: CanonicalStrategyV2,
    execution_state: Literal["incomplete", "unsupported", "executable"],
    product_message: str,
    *,
    semantic_state: Literal["valid", "invalid"] = "valid",
    technical_detail: str | None = None,
    required_symbols: tuple[str, ...] = (),
) -> V2ExecutionCapability:
    executable = execution_state == "executable"
    empty = not strategy.definitions.groups
    return V2ExecutionCapability(
        authoring_state="empty" if empty else "committed",
        semantic_state=semantic_state,
        execution_state=execution_state,
        product_message=product_message,
        technical_detail=technical_detail,
        required_symbols=required_symbols,
        reference_valid=semantic_state == "valid",
        backend_lowerable=executable,
        production_executable=executable,
        reason=None if executable else product_message,
    )


def assess_v2_execution_capability(strategy: CanonicalStrategyV2) -> V2ExecutionCapability:
    """Classify capability without using lowering failure as normal discovery."""
    issues = validate_strategy_v2(strategy)
    if issues:
        detail = "; ".join(f"{issue.path}: {issue.code}" for issue in issues)
        return _result(
            strategy,
            "unsupported",
            "Fix the strategy details before testing.",
            semantic_state="invalid",
            technical_detail=detail,
        )

    statements = _statements(strategy.program.statements if strategy.program else ())
    unresolved = next((item for item in statements if isinstance(item, UnresolvedStatementV2)), None)
    if unresolved is not None:
        return _result(
            strategy,
            "unsupported",
            "Finish defining the unresolved strategy rule before testing.",
            technical_detail=f"Program statement {unresolved.semantic_id!r} contains unresolved semantics",
        )

    selections = tuple(item for item in statements if isinstance(item, SelectionStatementV2))
    if not strategy.definitions.groups:
        return _result(
            strategy,
            "incomplete",
            "Add an investment and choose assets before testing.",
            technical_detail="production Program lowering currently requires exactly one Selection",
        )
    if any(
        not next((asset_set.assets for asset_set in strategy.definitions.asset_sets if asset_set.id == group.asset_set_ref), ())
        for group in strategy.definitions.groups
    ):
        return _result(
            strategy,
            "incomplete",
            "Choose assets for the investment before testing.",
            technical_detail="production execution requires a non-empty investment AssetSet",
        )
    allocations = tuple(item for item in statements if isinstance(item, AllocationStatementV2))
    policies = tuple(item for item in statements if isinstance(item, GuardedAllocationStatementV2))
    non_bootstrap_allocations = tuple(
        item for item in allocations
        if not (
            item.semantic_id == "initial-retain-allocation"
            and len(item.legs) == 1 and item.legs[0].target.kind == "retain"
        )
    )
    if not selections and not policies and not non_bootstrap_allocations:
        return _result(
            strategy,
            "incomplete",
            "Choose assets for the investment before testing.",
            technical_detail="production Program lowering currently requires exactly one Selection",
        )
    referenced_outputs = {
        leg.target.ref
        for allocation in non_bootstrap_allocations
        for leg in allocation.legs
        if leg.target.kind == "selection"
    } | {
        leg.target.ref
        for policy in policies
        for allocation in (
            policy.primary,
            *(item.action for item in policy.overrides),
            *((policy.fallback,) if policy.fallback is not None else ()),
        )
        for leg in allocation.legs
        if leg.target.kind == "selection"
    }
    missing_allocations = tuple(item for item in selections if item.output_id not in referenced_outputs)
    if missing_allocations and not policies:
        return _result(
            strategy,
            "incomplete",
            "Finish the investment selection before testing.",
            technical_detail="one or more Selection outputs have no committed Allocation",
        )

    clocks = {item.id: item for item in strategy.program.clocks}
    unsupported_clock = next((item for item in clocks.values() if item.timeframe == "session"), None)
    if unsupported_clock is not None:
        return _result(
            strategy,
            "unsupported",
            "This rebalance schedule is not yet supported for testing.",
            technical_detail="intraday/session Program timing has no maintained LEAN lowering",
        )

    # Complete documents are finally checked against the strict lowerer.  Any
    # failure here is a genuine unsupported subset, not an authoring draft.
    try:
        plan = compile_v2_strategy_to_lean_plan(strategy)
    except V2LoweringError as exc:
        return _result(
            strategy,
            "unsupported",
            "This strategy uses a rule that is not yet supported for testing.",
            technical_detail=str(exc),
        )
    return _result(
        strategy,
        "executable",
        "Ready to test.",
        required_symbols=tuple(item.symbol for item in plan.subscriptions),
    )
