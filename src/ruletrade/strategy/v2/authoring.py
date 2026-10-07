"""Atomic Profile A v2 semantic authoring operations.

Frontend drafts are intentionally absent from this module.  Only complete,
validated semantic objects cross this boundary and every response is a complete
Canonical replacement.
"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.models import (
    CanonicalStrategyV2,
    ConditionV2,
    Identifier,
    ProgramStatementV2,
    SelectionV2,
    SemanticProgramV2,
    Symbol,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.semantic_types import FrozenModel
from ruletrade.strategy.v2.validation import OperationCapability, v2_capabilities, validate_strategy_v2


class V2AuthoringError(ValueError):
    def __init__(self, code: str, message: str, *, path: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.path = path


class SetSelectionUniverse(FrozenModel):
    kind: Literal["set_selection_universe"]
    universe_id: Identifier


class SetEligibilityCondition(FrozenModel):
    kind: Literal["set_eligibility_condition"]
    condition: ConditionV2 | None


class SetRankingValue(FrozenModel):
    kind: Literal["set_ranking_value"]
    value: ValueExpressionV2


class SetRankingDirection(FrozenModel):
    kind: Literal["set_ranking_direction"]
    direction: Literal["ascending", "descending"]


class SetSelectionCount(FrozenModel):
    kind: Literal["set_selection_count"]
    count: Annotated[int, Field(ge=1, le=100)]


class SetShortagePolicy(FrozenModel):
    kind: Literal["set_shortage_policy"]
    shortage_policy: Literal["choose_all", "require_full"]


class SetSelectionFallback(FrozenModel):
    kind: Literal["set_selection_fallback"]
    fallback_asset: Symbol | None


class SetPredicate(FrozenModel):
    kind: Literal["set_predicate"]
    predicate: ConditionV2 | None


class SetSemanticProgram(FrozenModel):
    kind: Literal["set_semantic_program"]
    program: SemanticProgramV2


class ReplaceProgramStatement(FrozenModel):
    kind: Literal["replace_program_statement"]
    semantic_id: Identifier
    statement: ProgramStatementV2


V2AuthoringOperation = Annotated[
    SetSelectionUniverse
    | SetEligibilityCondition
    | SetRankingValue
    | SetRankingDirection
    | SetSelectionCount
    | SetShortagePolicy
    | SetSelectionFallback
    | SetPredicate
    | SetSemanticProgram
    | ReplaceProgramStatement,
    Field(discriminator="kind"),
]


class ApplyV2AuthoringRequest(FrozenModel):
    strategy: CanonicalStrategyV2
    expected_source_hash: str
    operation: V2AuthoringOperation


class ApplyV2AuthoringResponse(FrozenModel):
    strategy: CanonicalStrategyV2
    source_hash: str


class V2AuthoringCapability(FrozenModel):
    operation_id: str
    label: str
    available: bool
    reason: str | None = None


def authoring_capabilities() -> tuple[V2AuthoringCapability, ...]:
    ledger = v2_capabilities()
    values = (
        ("daily.adjusted_close@1", "Current adjusted close"),
        ("daily.trailing_return@1", "Trailing return"),
        ("daily.sma@1", "Simple moving average"),
        ("daily.ema@1", "Exponential moving average"),
        ("daily.rsi_wilder_lean_compat@1", "RSI"),
        ("daily.realized_volatility@1", "Realized volatility"),
        ("daily.volume_raw_shares@1", "Volume"),
        ("daily.raw_ohlc@1", "Raw OHLC"),
    )
    return tuple(
        V2AuthoringCapability(
            operation_id=operation_id,
            label=label,
            available=(ledger[operation_id].provider_available and ledger[operation_id].backend_lowerable and ledger[operation_id].verified_profile),
            reason=None if (ledger[operation_id].provider_available and ledger[operation_id].backend_lowerable and ledger[operation_id].verified_profile) else (
                "Unavailable with the maintained data provider."
                if not ledger[operation_id].provider_available
                else "Known semantic operation; executable authoring is not yet available."
            ),
        )
        for operation_id, label in values
    )


def _replace_program_statement(
    program: SemanticProgramV2,
    semantic_id: str,
    replacement: ProgramStatementV2,
) -> SemanticProgramV2:
    from ruletrade.strategy.v2.models import (
        AllocationStatementV2,
        ConditionalStatementV2,
        EventStatementV2,
        GuardedAllocationStatementV2,
    )

    matches = 0

    def visit(statement: ProgramStatementV2) -> ProgramStatementV2:
        nonlocal matches
        if statement.semantic_id == semantic_id:
            matches += 1
            return replacement
        if isinstance(statement, ConditionalStatementV2):
            return statement.model_copy(update={
                "then_statements": tuple(visit(item) for item in statement.then_statements),
                "otherwise_statements": tuple(visit(item) for item in statement.otherwise_statements),
            })
        if isinstance(statement, EventStatementV2):
            return statement.model_copy(update={
                "statements": tuple(visit(item) for item in statement.statements),
            })
        if isinstance(statement, GuardedAllocationStatementV2):
            def allocation(item: AllocationStatementV2) -> AllocationStatementV2:
                nonlocal matches
                if item.semantic_id != semantic_id:
                    return item
                matches += 1
                if not isinstance(replacement, AllocationStatementV2):
                    raise V2AuthoringError(
                        "program_statement_kind_mismatch",
                        "A nested Allocation address requires an Allocation replacement.",
                    )
                return replacement

            return statement.model_copy(update={
                "primary": allocation(statement.primary),
                "overrides": tuple(override.model_copy(update={
                    "action": allocation(override.action),
                }) for override in statement.overrides),
                "fallback": None if statement.fallback is None else allocation(statement.fallback),
            })
        return statement

    changed = program.model_copy(update={
        "statements": tuple(visit(item) for item in program.statements),
    })
    if matches == 0:
        raise V2AuthoringError(
            "program_statement_not_found",
            f"No Program statement has semantic id {semantic_id!r}.",
        )
    if matches > 1:
        raise V2AuthoringError(
            "ambiguous_program_address",
            f"Program semantic id {semantic_id!r} is not unique.",
        )
    return SemanticProgramV2.model_validate(changed)


def apply_v2_authoring(request: ApplyV2AuthoringRequest) -> ApplyV2AuthoringResponse:
    current_hash = strategy_hash(request.strategy)
    if current_hash != request.expected_source_hash:
        raise V2AuthoringError(
            "stale_authoring_source",
            "Strategy changed after this editor request was created.",
        )

    operation = request.operation
    selection = request.strategy.selection
    selection_operations = (
        SetSelectionUniverse, SetEligibilityCondition, SetRankingValue,
        SetRankingDirection, SetSelectionCount, SetShortagePolicy,
        SetSelectionFallback,
    )
    if isinstance(operation, selection_operations) and selection is None:
        raise V2AuthoringError(
            "compatibility_selection_missing",
            "This Strategy is Program-native; address a Program statement instead.",
        )
    if isinstance(operation, SetSelectionUniverse):
        selection = selection.model_copy(update={
            "universe_id": operation.universe_id,
            "binding": selection.binding.model_copy(update={"domain_id": operation.universe_id}),
        })
    elif isinstance(operation, SetEligibilityCondition):
        selection = selection.model_copy(update={"eligibility": operation.condition})
    elif isinstance(operation, SetRankingValue):
        selection = selection.model_copy(update={"ranking": operation.value})
    elif isinstance(operation, SetRankingDirection):
        selection = selection.model_copy(update={"direction": operation.direction})
    elif isinstance(operation, SetSelectionCount):
        selection = selection.model_copy(update={"count": operation.count})
    elif isinstance(operation, SetShortagePolicy):
        selection = selection.model_copy(update={"shortage_policy": operation.shortage_policy})
    elif isinstance(operation, SetSelectionFallback):
        selection = selection.model_copy(update={"fallback_asset": operation.fallback_asset})

    if isinstance(operation, SetPredicate):
        candidate = request.strategy.model_copy(update={"predicate": operation.predicate})
    elif isinstance(operation, SetSemanticProgram):
        candidate = request.strategy.model_copy(update={"program": operation.program})
    elif isinstance(operation, ReplaceProgramStatement):
        if request.strategy.program is None:
            raise V2AuthoringError(
                "semantic_program_missing",
                "This Strategy does not yet contain a Semantic Program.",
            )
        candidate = request.strategy.model_copy(update={
            "program": _replace_program_statement(
                request.strategy.program, operation.semantic_id, operation.statement,
            ),
        })
    else:
        candidate = request.strategy.model_copy(update={"selection": SelectionV2.model_validate(selection)})

    issues = validate_strategy_v2(candidate)
    if issues:
        first = issues[0]
        raise V2AuthoringError(first.code, first.message, path=first.path)
    return ApplyV2AuthoringResponse(strategy=candidate, source_hash=strategy_hash(candidate))
