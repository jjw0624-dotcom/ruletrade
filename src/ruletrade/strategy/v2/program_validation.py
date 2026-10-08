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
    ClockedValueV2,
    RememberedValueV2,
    BarsSinceEventValueV2,
    BarsSinceStateValueV2,
    TimeSinceEventValueV2,
    TimeSinceStateValueV2,
    EventWindowConditionV2,
    NOfMConditionV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    ProgramStatementV2,
    ScoreValueV2,
    SelectionStatementV2,
    SemanticProgramV2,
    StateTransitionStatementV2,
    StateConditionV2,
    RememberValueStatementV2,
    UnresolvedStatementV2,
    ValueExpressionV2,
    CrossSectionalValueV2,
    CrossSectionalAggregateValueV2,
)
from ruletrade.strategy.v2.semantic_types import Quantity, SemanticDType, SemanticType, Unit
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
    if isinstance(value, (CrossSectionalValueV2, CrossSectionalAggregateValueV2)):
        return daily_nodes_for_value(value.source)
    if isinstance(value, ScoreValueV2):
        return (
            tuple(node for term in value.terms for node in daily_nodes_for_value(term.value))
            + tuple(
                node
                for term in value.condition_terms
                for item in _condition_values(term.condition)
                for node in daily_nodes_for_value(item)
            )
        )
    if isinstance(value, EventRelativeValueV2):
        return daily_nodes_for_value(value.source)
    if isinstance(value, ClockedValueV2):
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
    if isinstance(condition, (BooleanGroupV2, NOfMConditionV2)):
        return tuple(value for child in condition.children for value in _condition_values(child))
    if isinstance(condition, NotConditionV2):
        return _condition_values(condition.child)
    return ()


def _condition_state_keys(condition) -> tuple[str, ...]:
    from ruletrade.strategy.v2.models import BooleanGroupV2, NotConditionV2
    if isinstance(condition, StateConditionV2):
        return (condition.state_key,)
    if isinstance(condition, (BooleanGroupV2, NOfMConditionV2)):
        return tuple(key for child in condition.children for key in _condition_state_keys(child))
    if isinstance(condition, NotConditionV2):
        return _condition_state_keys(condition.child)
    return ()


def _selection_values(statement: SelectionStatementV2) -> tuple[ValueExpressionV2, ...]:
    values: list[ValueExpressionV2] = [statement.selection.ranking]
    if statement.selection.eligibility is not None:
        values.extend(_condition_values(statement.selection.eligibility))
    return tuple(values)


def _cross_section_values(value: ValueExpressionV2) -> tuple[CrossSectionalValueV2, ...]:
    if isinstance(value, CrossSectionalValueV2):
        return (value,)
    if isinstance(value, CrossSectionalAggregateValueV2):
        return _cross_section_values(value.source)
    if isinstance(value, ScoreValueV2):
        return (
            tuple(item for term in value.terms for item in _cross_section_values(term.value))
            + tuple(
                item
                for term in value.condition_terms
                for child in _condition_values(term.condition)
                for item in _cross_section_values(child)
            )
        )
    return ()


def _score_condition_terms(value: ValueExpressionV2):
    if isinstance(value, ScoreValueV2):
        return tuple(term.condition for term in value.condition_terms)
    return ()


def _cross_domain_values(value: ValueExpressionV2):
    if isinstance(value, (CrossSectionalValueV2, CrossSectionalAggregateValueV2)):
        return (value,) + _cross_domain_values(value.source)
    if isinstance(value, ScoreValueV2):
        return tuple(item for term in value.terms for item in _cross_domain_values(term.value))
    return ()


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
            if statement.event.condition is not None:
                values.extend(_condition_values(statement.event.condition))
        elif isinstance(statement, StateTransitionStatementV2):
            values.extend(_condition_values(statement.transition.when))
        elif isinstance(statement, GuardedAllocationStatementV2):
            if statement.guard is not None:
                values.extend(_condition_values(statement.guard))
            for override in statement.overrides:
                values.extend(_condition_values(override.when))
        elif isinstance(statement, RememberValueStatementV2):
            values.append(statement.value)
        stack.extend(_statement_children(statement))
    return tuple(values)


def _value_semantic_ids(value: ValueExpressionV2) -> set[str]:
    result = {value.semantic_id}
    if isinstance(value, DailyValueNode):
        stack = list(value.operands)
        while stack:
            node = stack.pop()
            result.add(node.semantic_id)
            stack.extend(node.operands)
    elif isinstance(value, (CrossSectionalValueV2, CrossSectionalAggregateValueV2)):
        result |= _value_semantic_ids(value.source)
    elif isinstance(value, ScoreValueV2):
        for term in value.terms:
            result.add(term.semantic_id)
            result |= _value_semantic_ids(term.value)
        for term in value.condition_terms:
            result.add(term.semantic_id)
            result |= _condition_semantic_ids(term.condition)
    elif isinstance(value, (EventRelativeValueV2, ClockedValueV2)):
        result |= _value_semantic_ids(value.source)
    return result


def _condition_semantic_ids(condition) -> set[str]:
    result = {condition.semantic_id}
    from ruletrade.strategy.v2.models import BooleanGroupV2, ComparisonV2, NotConditionV2
    if isinstance(condition, ComparisonV2):
        result |= _value_semantic_ids(condition.left) | _value_semantic_ids(condition.right)
    elif isinstance(condition, (BooleanGroupV2, NOfMConditionV2)):
        for child in condition.children:
            result |= _condition_semantic_ids(child)
    elif isinstance(condition, NotConditionV2):
        result |= _condition_semantic_ids(condition.child)
    return result


def validate_program_v2(program: SemanticProgramV2) -> tuple[SemanticDiagnostic, ...]:
    diagnostics: list[SemanticDiagnostic] = []
    clocks = {clock.id: clock for clock in program.clocks}
    statement_ids: set[str] = set()
    event_ids: set[str] = set()
    declared_selection_outputs: set[str] = set()
    selection_output_types: dict[str, SemanticType] = {}
    declared_memories: set[str] = set()
    referenced_event_windows: list[tuple[str, str]] = []
    condition_ids: set[str] = set()

    def condition(condition, path: str, role: SemanticRole = SemanticRole.PREDICATE, binding_id: str | None = None) -> None:
        diagnostics.extend(validate_condition(condition, role, bound_candidate_id=binding_id))
        condition_ids.update(_condition_semantic_ids(condition))
        def collect_event_windows(item) -> None:
            from ruletrade.strategy.v2.models import BooleanGroupV2, NotConditionV2
            if isinstance(item, EventWindowConditionV2):
                referenced_event_windows.append((item.event_id, path))
            elif isinstance(item, (BooleanGroupV2, NOfMConditionV2)):
                for child in item.children:
                    collect_event_windows(child)
            elif isinstance(item, NotConditionV2):
                collect_event_windows(item.child)
        collect_event_windows(condition)
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
        if statement.method in {"proportional_score", "inverse_volatility"}:
            output_id = statement.legs[0].target.ref or ""
            input_type = selection_output_types.get(output_id)
            if input_type is not None and statement.method == "proportional_score" and input_type.quantity != Quantity.SCORE:
                diagnostics.append(SemanticDiagnostic(
                    "proportional_allocation_requires_score", f"{path}.method",
                    "Proportional allocation requires an explicit Score-valued Selection ranking.",
                ))
            if input_type is not None and statement.method == "inverse_volatility" and not (
                input_type.refinement or ""
            ).startswith("realized_volatility:"):
                diagnostics.append(SemanticDiagnostic(
                    "inverse_volatility_requires_volatility", f"{path}.method",
                    "Inverse-volatility allocation requires a realized-volatility Selection ranking.",
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
            for cross_section in _cross_domain_values(statement.selection.ranking):
                if cross_section.domain_id != statement.selection.universe_id:
                    diagnostics.append(SemanticDiagnostic(
                        "cross_section_domain_mismatch", f"{path}.selection.ranking",
                        "Cross-sectional ranking domain must equal the Selection universe.",
                    ))
            if statement.selection.eligibility is not None:
                condition(statement.selection.eligibility, f"{path}.selection.eligibility", SemanticRole.ELIGIBILITY, statement.selection.binding.id)
            for index, score_condition in enumerate(_score_condition_terms(statement.selection.ranking)):
                condition(
                    score_condition, f"{path}.selection.ranking.condition_terms[{index}]",
                    SemanticRole.ELIGIBILITY, statement.selection.binding.id,
                )
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
                selection_output_types[statement.output_id] = rank_type
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
            if statement.event.condition is not None:
                condition(statement.event.condition, f"{path}.event.condition")
            event_outputs = set(available_outputs)
            for index, child in enumerate(statement.statements):
                event_outputs = visit(child, f"{path}.statements[{index}]", event_outputs)
            return available_outputs
        if isinstance(statement, RememberValueStatementV2):
            clock_ref(statement.clock_id, f"{path}.clock_id")
            if statement.memory_id in declared_memories:
                diagnostics.append(SemanticDiagnostic(
                    "duplicate_memory_id", f"{path}.memory_id",
                    "Remembered value ids must be unique Program addresses.",
                ))
            declared_memories.add(statement.memory_id)
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
        if isinstance(value, (CrossSectionalValueV2, CrossSectionalAggregateValueV2)):
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
        if isinstance(value, (BarsSinceEventValueV2, TimeSinceEventValueV2)) and value.event_id not in event_ids:
            diagnostics.append(SemanticDiagnostic(
                "unknown_event_reference", value.semantic_id,
                "Bars-since-Event Values must reference a declared Event.",
            ))
        if isinstance(value, (BarsSinceStateValueV2, TimeSinceStateValueV2)) and value.state_key not in program.initial_state:
            diagnostics.append(SemanticDiagnostic(
                "undeclared_state", value.semantic_id,
                "Bars-since-State Values require an initialized state key.",
            ))
        if isinstance(value, RememberedValueV2) and value.memory_id not in declared_memories:
            diagnostics.append(SemanticDiagnostic(
                "unknown_memory_reference", value.semantic_id,
                "Remembered Values must reference a declared memory address.",
            ))
        if isinstance(value, ClockedValueV2) and value.clock_id not in clocks:
            diagnostics.append(SemanticDiagnostic(
                "unknown_program_clock", value.semantic_id,
                "Clocked Values require a declared Program clock.",
            ))
        for node in daily_nodes_for_value(value):
            if node.kind == "observe" and not (
                node.field == MarketField.CLOSE and node.basis == PriceBasis.ADJUSTED
            ):
                diagnostics.append(SemanticDiagnostic(
                    "provider_capability_unavailable", node.semantic_id,
                    "The maintained provider supports adjusted close only.",
                ))
    for event_id, path in referenced_event_windows:
        if event_id not in event_ids:
            diagnostics.append(SemanticDiagnostic(
                "unknown_event_reference", path,
                f"Event window references undeclared Event {event_id!r}.",
            ))
    executable_ids = statement_ids | event_ids | declared_selection_outputs | declared_memories | condition_ids
    for value in program_values(program):
        executable_ids |= _value_semantic_ids(value)
    for index, formalization in enumerate(program.formalizations):
        if formalization.status == "unresolved":
            diagnostics.append(SemanticDiagnostic(
                "unresolved_formalization", f"program.formalizations[{index}]",
                f"The original phrase remains non-executable: {formalization.source_phrase}",
            ))
        for semantic_id in formalization.semantic_ids:
            if semantic_id not in executable_ids:
                diagnostics.append(SemanticDiagnostic(
                    "unknown_formalized_semantic_id", f"program.formalizations[{index}]",
                    f"Formalization points to unknown semantic id {semantic_id!r}.",
                ))
    return tuple(diagnostics)


def infer_program_value_type(value: ValueExpressionV2, *, binding_id: str | None = None):
    if isinstance(value, DailyValueNode):
        return infer_daily_type(value, binding_id=binding_id)
    if isinstance(value, CrossSectionalValueV2):
        source = infer_program_value_type(value.source, binding_id=binding_id)
        return source.model_copy(update={
            "quantity": Quantity.SCORE,
            "unit": Unit.RATIO if value.transform in {"percentile", "min_max", "zscore"} else Unit.POINTS,
            "refinement": f"cross_sectional:{value.transform}@1",
            "axes": (),
        })
    if isinstance(value, CrossSectionalAggregateValueV2):
        source = infer_program_value_type(value.source, binding_id=binding_id)
        return source.model_copy(update={"axes": ()})
    if isinstance(value, ScoreValueV2):
        for term in value.terms:
            term_type = infer_program_value_type(term.value, binding_id=binding_id)
            if term_type.dtype not in {SemanticDType.DECIMAL, SemanticDType.INTEGER}:
                raise ValueError("score_term_not_numeric")
            if term_type.unit not in {Unit.RATIO, Unit.POINTS}:
                raise ValueError("score_term_not_dimensionless")
        template = infer_program_value_type(value.terms[0].value, binding_id=binding_id) if value.terms else None
        from ruletrade.strategy.v2.semantic_types import SemanticType
        return (template or SemanticType(
            dtype=SemanticDType.DECIMAL, quantity=Quantity.SCORE, unit=Unit.POINTS,
        )).model_copy(update={
            "quantity": Quantity.SCORE,
            "unit": Unit.POINTS,
            "refinement": "weighted_score@1",
            "axes": (),
        })
    if isinstance(value, EventRelativeValueV2):
        return infer_daily_type(value.source, binding_id=binding_id)
    if isinstance(value, ClockedValueV2):
        return infer_daily_type(value.source, binding_id=binding_id)
    if isinstance(value, RememberedValueV2):
        from ruletrade.strategy.v2.semantic_types import SemanticType
        return SemanticType(
            dtype=SemanticDType.DECIMAL, quantity=value.quantity, unit=value.unit,
            refinement=value.refinement,
        )
    if isinstance(value, (BarsSinceEventValueV2, BarsSinceStateValueV2, TimeSinceEventValueV2, TimeSinceStateValueV2)):
        from ruletrade.strategy.v2.semantic_types import SemanticType
        return SemanticType(
            dtype=SemanticDType.INTEGER, quantity=Quantity.COUNT, unit=Unit.COUNT,
            refinement=(
                "elapsed_calendar_days@1"
                if isinstance(value, (TimeSinceEventValueV2, TimeSinceStateValueV2))
                else "elapsed_observations@1"
            ),
        )
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
        "selection", "condition", "daily_value", "normalization", "n_of_m",
        "remembered_value", "sequence", "scheduled_event", "allocation_bounds",
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
