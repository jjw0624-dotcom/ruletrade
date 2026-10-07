"""Validation and corpus classification for the Semantic Program Core."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from ruletrade.strategy.v2.daily_values import (
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
    infer_daily_type,
)
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    ConditionalStatementV2,
    EventRelativeValueV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    ProgramStatementV2,
    ScoreValueV2,
    SelectionStatementV2,
    SemanticProgramV2,
    StateTransitionStatementV2,
    StateConditionV2,
    UnresolvedStatementV2,
    ValueExpressionV2,
    CrossSectionalValueV2,
)
from ruletrade.strategy.v2.semantic_types import Quantity, SemanticDType, Unit
from ruletrade.strategy.v2.validation import (
    SemanticDiagnostic,
    SemanticRole,
    validate_condition,
)


class CorpusDisposition(StrEnum):
    REPRESENTABLE = "representable"
    PROVIDER_BLOCKED = "provider_blocked"
    UNRESOLVED = "unresolved"
    DEFERRED = "deferred"


@dataclass(frozen=True)
class CorpusCaseResult:
    case_id: str
    disposition: CorpusDisposition
    reason: str


def daily_nodes_for_value(value: ValueExpressionV2) -> tuple[DailyValueNode, ...]:
    if isinstance(value, DailyValueNode):
        result: list[DailyValueNode] = []
        stack = [value]
        while stack:
            node = stack.pop()
            result.append(node)
            stack.extend(node.operands)
        return tuple(result)
    if isinstance(value, CrossSectionalValueV2):
        return daily_nodes_for_value(value.source)
    if isinstance(value, ScoreValueV2):
        return tuple(node for term in value.terms for node in daily_nodes_for_value(term.value))
    if isinstance(value, EventRelativeValueV2):
        return daily_nodes_for_value(value.source)
    return ()


def _statement_children(statement: ProgramStatementV2) -> tuple[ProgramStatementV2, ...]:
    if isinstance(statement, ConditionalStatementV2):
        return statement.then_statements + statement.otherwise_statements
    if isinstance(statement, EventStatementV2):
        return statement.statements
    return ()


def _condition_values(condition) -> tuple[ValueExpressionV2, ...]:
    from ruletrade.strategy.v2.models import BooleanGroupV2, ComparisonV2, NotConditionV2
    if isinstance(condition, ComparisonV2):
        return (condition.left, condition.right)
    if isinstance(condition, BooleanGroupV2):
        return tuple(value for child in condition.children for value in _condition_values(child))
    if isinstance(condition, NotConditionV2):
        return _condition_values(condition.child)
    return ()


def _condition_state_keys(condition) -> tuple[str, ...]:
    from ruletrade.strategy.v2.models import BooleanGroupV2, NotConditionV2
    if isinstance(condition, StateConditionV2):
        return (condition.state_key,)
    if isinstance(condition, BooleanGroupV2):
        return tuple(key for child in condition.children for key in _condition_state_keys(child))
    if isinstance(condition, NotConditionV2):
        return _condition_state_keys(condition.child)
    return ()


def _selection_values(statement: SelectionStatementV2) -> tuple[ValueExpressionV2, ...]:
    values: list[ValueExpressionV2] = [statement.selection.ranking]
    if statement.selection.eligibility is not None:
        values.extend(_condition_values(statement.selection.eligibility))
    return tuple(values)


def program_values(program: SemanticProgramV2) -> tuple[ValueExpressionV2, ...]:
    values: list[ValueExpressionV2] = []
    stack = list(program.statements)
    while stack:
        statement = stack.pop()
        if isinstance(statement, SelectionStatementV2):
            values.extend(_selection_values(statement))
        elif isinstance(statement, ConditionalStatementV2):
            values.extend(_condition_values(statement.condition))
        elif isinstance(statement, EventStatementV2):
            values.extend(_condition_values(statement.event.condition))
        elif isinstance(statement, StateTransitionStatementV2):
            values.extend(_condition_values(statement.transition.when))
        elif isinstance(statement, GuardedAllocationStatementV2):
            if statement.guard is not None:
                values.extend(_condition_values(statement.guard))
            for override in statement.overrides:
                values.extend(_condition_values(override.when))
        stack.extend(_statement_children(statement))
    return tuple(values)


def validate_program_v2(program: SemanticProgramV2) -> tuple[SemanticDiagnostic, ...]:
    diagnostics: list[SemanticDiagnostic] = []
    clocks = {clock.id: clock for clock in program.clocks}
    statement_ids: set[str] = set()
    event_ids: set[str] = set()
    declared_selection_outputs: set[str] = set()

    def condition(condition, path: str, role: SemanticRole = SemanticRole.PREDICATE, binding_id: str | None = None) -> None:
        diagnostics.extend(validate_condition(condition, role, bound_candidate_id=binding_id))
        for state_key in _condition_state_keys(condition):
            if state_key not in program.initial_state:
                diagnostics.append(SemanticDiagnostic(
                    "undeclared_state", path,
                    f"State condition references uninitialized key {state_key!r}.",
                ))

    def clock_ref(clock_id: str | None, path: str) -> None:
        if clock_id is not None and clock_id not in clocks:
            diagnostics.append(SemanticDiagnostic(
                "unknown_program_clock", path, f"Program clock {clock_id!r} is not defined.",
            ))

    def allocation(statement: AllocationStatementV2, path: str, available_outputs: set[str]) -> None:
        clock_ref(statement.clock_id, f"{path}.clock_id")
        for index, leg in enumerate(statement.legs):
            if leg.target.kind == "selection" and leg.target.ref not in available_outputs:
                diagnostics.append(SemanticDiagnostic(
                    "unknown_selection_output",
                    f"{path}.legs[{index}].target.ref",
                    "Allocation must reference a Selection output defined earlier in program order.",
                ))

    def register_statement(statement: AllocationStatementV2 | ProgramStatementV2, path: str) -> None:
        if statement.semantic_id in statement_ids:
            diagnostics.append(SemanticDiagnostic(
                "duplicate_program_semantic_id", path, "Program semantic ids must be unique.",
            ))
        statement_ids.add(statement.semantic_id)

    def visit(statement: ProgramStatementV2, path: str, available_outputs: set[str]) -> set[str]:
        register_statement(statement, path)
        if isinstance(statement, UnresolvedStatementV2):
            diagnostics.append(SemanticDiagnostic(
                "unresolved_semantics", path,
                f"{statement.category}: {statement.reason}. Fuzzy text remains draft-only.",
            ))
            return available_outputs
        if isinstance(statement, SelectionStatementV2):
            clock_ref(statement.clock_id, f"{path}.clock_id")
            if statement.output_id in declared_selection_outputs:
                diagnostics.append(SemanticDiagnostic(
                    "duplicate_selection_output", f"{path}.output_id",
                    "Selection output ids must be unique.",
                ))
            declared_selection_outputs.add(statement.output_id)
            if statement.selection.eligibility is not None:
                condition(statement.selection.eligibility, f"{path}.selection.eligibility", SemanticRole.ELIGIBILITY, statement.selection.binding.id)
            try:
                rank_type = infer_program_value_type(
                    statement.selection.ranking,
                    binding_id=statement.selection.binding.id,
                )
            except ValueError as exc:
                diagnostics.append(SemanticDiagnostic(
                    str(exc).split(":", 1)[0], f"{path}.selection.ranking", str(exc),
                ))
            else:
                if rank_type.dtype not in {SemanticDType.DECIMAL, SemanticDType.INTEGER} or rank_type.axes:
                    diagnostics.append(SemanticDiagnostic(
                        "ranking_not_candidate_scalar", f"{path}.selection.ranking",
                        "Selection ranking must yield one comparable scalar per Candidate.",
                    ))
            return available_outputs | {statement.output_id}
        if isinstance(statement, AllocationStatementV2):
            allocation(statement, path, available_outputs)
            return available_outputs
        if isinstance(statement, ConditionalStatementV2):
            clock_ref(statement.clock_id, f"{path}.clock_id")
            condition(statement.condition, f"{path}.condition")
            then_outputs = set(available_outputs)
            for index, child in enumerate(statement.then_statements):
                then_outputs = visit(child, f"{path}.then[{index}]", then_outputs)
            otherwise_outputs = set(available_outputs)
            for index, child in enumerate(statement.otherwise_statements):
                otherwise_outputs = visit(child, f"{path}.otherwise[{index}]", otherwise_outputs)
            return available_outputs | (then_outputs & otherwise_outputs)
        if isinstance(statement, EventStatementV2):
            clock_ref(statement.event.clock_id, f"{path}.event.clock_id")
            if statement.event.semantic_id in event_ids:
                diagnostics.append(SemanticDiagnostic(
                    "duplicate_event_id", f"{path}.event.semantic_id",
                    "Event semantic ids must be unique.",
                ))
            event_ids.add(statement.event.semantic_id)
            condition(statement.event.condition, f"{path}.event.condition")
            event_outputs = set(available_outputs)
            for index, child in enumerate(statement.statements):
                event_outputs = visit(child, f"{path}.statements[{index}]", event_outputs)
            return available_outputs
        if isinstance(statement, StateTransitionStatementV2):
            clock_ref(statement.transition.clock_id, f"{path}.transition.clock_id")
            condition(statement.transition.when, f"{path}.transition.when")
            if statement.transition.state_key not in program.initial_state:
                diagnostics.append(SemanticDiagnostic(
                    "undeclared_state", f"{path}.transition.state_key",
                    "State transitions require an explicitly initialized state key.",
                ))
            return available_outputs
        if isinstance(statement, GuardedAllocationStatementV2):
            if statement.guard is not None:
                condition(statement.guard, f"{path}.guard")
            priorities = [item.priority for item in statement.overrides]
            if len(priorities) != len(set(priorities)):
                diagnostics.append(SemanticDiagnostic(
                    "duplicate_override_priority", f"{path}.overrides",
                    "Override priorities must be unique; highest priority wins.",
                ))
            register_statement(statement.primary, f"{path}.primary")
            allocation(statement.primary, f"{path}.primary", available_outputs)
            for index, override in enumerate(statement.overrides):
                condition(override.when, f"{path}.overrides[{index}].when")
                register_statement(override.action, f"{path}.overrides[{index}].action")
                allocation(override.action, f"{path}.overrides[{index}].action", available_outputs)
            if statement.fallback is not None:
                register_statement(statement.fallback, f"{path}.fallback")
                allocation(statement.fallback, f"{path}.fallback", available_outputs)
            return available_outputs

    available_outputs: set[str] = set()
    for index, statement in enumerate(program.statements):
        available_outputs = visit(statement, f"program.statements[{index}]", available_outputs)

    for value in program_values(program):
        if isinstance(value, CrossSectionalValueV2):
            candidate_sources = [
                node for node in daily_nodes_for_value(value.source)
                if node.subject_kind == SubjectKind.CANDIDATE
            ]
            if not candidate_sources:
                diagnostics.append(SemanticDiagnostic(
                    "cross_section_requires_candidate",
                    value.semantic_id,
                    "Rank/percentile/quantile/bucket requires a Candidate source.",
                ))
        if isinstance(value, EventRelativeValueV2) and value.event_id not in event_ids:
            diagnostics.append(SemanticDiagnostic(
                "unknown_event_reference", value.semantic_id,
                "Event-relative Values must reference an Event declared in the Program.",
            ))
        for node in daily_nodes_for_value(value):
            if node.kind == "observe" and not (
                node.field == MarketField.CLOSE and node.basis == PriceBasis.ADJUSTED
            ):
                diagnostics.append(SemanticDiagnostic(
                    "provider_capability_unavailable", node.semantic_id,
                    "The maintained provider supports adjusted close only.",
                ))
    return tuple(diagnostics)


def infer_program_value_type(value: ValueExpressionV2, *, binding_id: str | None = None):
    if isinstance(value, DailyValueNode):
        return infer_daily_type(value, binding_id=binding_id)
    if isinstance(value, CrossSectionalValueV2):
        source = infer_daily_type(value.source, binding_id=binding_id)
        return source.model_copy(update={
            "quantity": Quantity.SCORE,
            "unit": Unit.RATIO if value.transform == "percentile" else Unit.POINTS,
            "refinement": f"cross_sectional:{value.transform}@1",
            "axes": (),
        })
    if isinstance(value, ScoreValueV2):
        for term in value.terms:
            term_type = infer_program_value_type(term.value, binding_id=binding_id)
            if term_type.dtype not in {SemanticDType.DECIMAL, SemanticDType.INTEGER}:
                raise ValueError("score_term_not_numeric")
        first = infer_program_value_type(value.terms[0].value, binding_id=binding_id)
        return first.model_copy(update={
            "quantity": Quantity.SCORE,
            "unit": Unit.POINTS,
            "refinement": "weighted_score@1",
            "axes": (),
        })
    if isinstance(value, EventRelativeValueV2):
        return infer_daily_type(value.source, binding_id=binding_id)
    semantic_type = getattr(value, "semantic_type", None)
    if semantic_type is None:
        raise ValueError("unsupported_program_value")
    return semantic_type


def classify_corpus_case(
    case_id: str,
    *,
    required_semantics: set[str],
    provider_fields: set[str] = frozenset({"adjusted_close"}),
    has_fuzzy_terms: bool = False,
) -> CorpusCaseResult:
    """Classify a natural-language case without pretending to parse fuzzy prose."""

    if has_fuzzy_terms:
        return CorpusCaseResult(
            case_id, CorpusDisposition.UNRESOLVED,
            "Fuzzy terms require an explicit user-authored formal definition.",
        )
    unavailable = provider_fields - {"adjusted_close"}
    if unavailable:
        return CorpusCaseResult(
            case_id, CorpusDisposition.PROVIDER_BLOCKED,
            f"Provider fields unavailable: {', '.join(sorted(unavailable))}.",
        )
    supported = {
        "cross_section", "score", "event", "state", "event_relative",
        "multi_clock", "allocation", "guard", "override", "fallback",
        "selection", "condition", "daily_value",
    }
    unknown = required_semantics - supported
    if unknown:
        return CorpusCaseResult(
            case_id, CorpusDisposition.DEFERRED,
            f"Semantic families deferred: {', '.join(sorted(unknown))}.",
        )
    return CorpusCaseResult(
        case_id, CorpusDisposition.REPRESENTABLE,
        "All required semantics map to explicit Program Core nodes.",
    )
