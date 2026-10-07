"""Type, role, readiness, and operation contracts for CanonicalStrategyV2."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from ruletrade.strategy.v2.models import (
    CandidateCurrentPriceValue,
    CandidateTrailingReturnValue,
    BooleanGroupV2,
    CanonicalStrategyV2,
    ComparisonV2,
    ConditionV2,
    LiteralValue,
    NotConditionV2,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.daily_values import DailyValueNode, SubjectKind, infer_daily_type, plan_daily_value
from ruletrade.strategy.v2.semantic_types import (
    HistoryRequirement,
    Quantity,
    SemanticDType,
    SemanticType,
    SemanticTypeError,
    Unit,
    require_compatible_values,
)


class SemanticRole(StrEnum):
    PREDICATE = "predicate"
    ELIGIBILITY = "eligibility"
    RANKING = "ranking"
    ALLOCATION_INPUT = "allocation_input"
    RESEARCH_PREVIEW = "research_preview"


class ValueValidity(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    NOT_EVALUATED = "not_evaluated"


@dataclass(frozen=True)
class SemanticDiagnostic:
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class OperationCapability:
    parseable: bool
    type_valid: bool
    role_valid: bool
    provider_available: bool
    historical_safe: bool
    reference_evaluable: bool
    backend_lowerable: bool
    authoring_reachable: bool
    verified_profile: bool

    @property
    def production_ready(self) -> bool:
        return all((
            self.parseable, self.type_valid, self.role_valid, self.provider_available,
            self.historical_safe, self.reference_evaluable, self.backend_lowerable,
            self.authoring_reachable, self.verified_profile,
        ))


@dataclass(frozen=True)
class OpSpec:
    id: str
    semantic_version: str
    accepted_roles: tuple[SemanticRole, ...]
    natural_clock: str
    history_requirement: HistoryRequirement
    required_data_fields: tuple[str, ...]
    purity: Literal["pure", "effect"]
    reference_evaluator: str | None
    backend_lowering: str | None
    evidence_formatter: str


OP_SPECS: dict[str, OpSpec] = {
    "candidate.trailing_return": OpSpec(
        id="candidate.trailing_return",
        semantic_version="1",
        accepted_roles=(SemanticRole.ELIGIBILITY, SemanticRole.RANKING, SemanticRole.RESEARCH_PREVIEW),
        natural_clock="daily-close",
        history_requirement=HistoryRequirement(minimum_history_lower_bound=2),
        required_data_fields=("adjusted_close",),
        purity="pure",
        reference_evaluator="ruletrade.v1.trailing_return",
        backend_lowering="ruletrade.v1.trailing_return_indicator@1",
        evidence_formatter="trailing_return",
    ),
    "candidate.current_price": OpSpec(
        id="candidate.current_price",
        semantic_version="1",
        accepted_roles=(SemanticRole.ELIGIBILITY, SemanticRole.RANKING, SemanticRole.RESEARCH_PREVIEW),
        natural_clock="daily-close",
        history_requirement=HistoryRequirement(minimum_history_lower_bound=1),
        required_data_fields=("adjusted_close",),
        purity="pure",
        reference_evaluator="ruletrade.v1.current_price",
        backend_lowering="ruletrade.v1.current_price",
        evidence_formatter="current_price",
    ),
    "compare": OpSpec(
        id="compare",
        semantic_version="1",
        accepted_roles=(SemanticRole.PREDICATE, SemanticRole.ELIGIBILITY, SemanticRole.RESEARCH_PREVIEW),
        natural_clock="inherited",
        history_requirement=HistoryRequirement(minimum_history_lower_bound=0),
        required_data_fields=(),
        purity="pure",
        reference_evaluator=None,
        backend_lowering="ruletrade.v1.comparison",
        evidence_formatter="comparison",
    ),
}


def infer_value_type(expression: ValueExpressionV2, *, binding_id: str | None = None) -> SemanticType:
    if isinstance(expression, DailyValueNode):
        return infer_daily_type(expression, binding_id=binding_id)
    return expression.semantic_type


def _history_requirement(expression: ValueExpressionV2) -> HistoryRequirement:
    if isinstance(expression, CandidateTrailingReturnValue):
        # n-observation return needs n + 1 completed closes.
        return HistoryRequirement(expression.lookback_observations + 1)
    if isinstance(expression, CandidateCurrentPriceValue):
        return HistoryRequirement(1)
    if isinstance(expression, LiteralValue):
        return HistoryRequirement(0)
    if isinstance(expression, DailyValueNode):
        return plan_daily_value(expression).history
    raise TypeError(f"unknown v2 expression: {type(expression)!r}")


def _daily_candidate_ids(expression: DailyValueNode) -> tuple[str, ...]:
    result: list[str] = []
    stack = [expression]
    while stack:
        node = stack.pop()
        if node.subject_kind == SubjectKind.CANDIDATE and node.binding_id:
            result.append(node.binding_id)
        stack.extend(node.operands)
    return tuple(result)


def validate_comparison(
    comparison: ComparisonV2,
    role: SemanticRole,
    *,
    bound_candidate_id: str | None,
) -> tuple[SemanticDiagnostic, ...]:
    diagnostics: list[SemanticDiagnostic] = []
    for path, expression in (("left", comparison.left), ("right", comparison.right)):
        bindings: tuple[str, ...]
        if isinstance(expression, DailyValueNode):
            bindings = _daily_candidate_ids(expression)
        elif isinstance(expression, (CandidateTrailingReturnValue, CandidateCurrentPriceValue)):
            bindings = (expression.binding_id,)
        else:
            bindings = ()
        for candidate_id in bindings:
            if role == SemanticRole.PREDICATE:
                diagnostics.append(SemanticDiagnostic(
                    "unbound_candidate", path,
                    "Candidate values are legal only inside an Eligibility/Ranking lexical binding.",
                ))
            elif candidate_id != bound_candidate_id:
                diagnostics.append(SemanticDiagnostic(
                    "unbound_candidate", path,
                    "Candidate value does not belong to this Selection binder.",
                ))
    try:
        axes = require_compatible_values(
            infer_value_type(comparison.left, binding_id=bound_candidate_id),
            infer_value_type(comparison.right, binding_id=bound_candidate_id),
        )
    except (SemanticTypeError, ValueError) as exc:
        diagnostics.append(SemanticDiagnostic(str(exc).split(":", 1)[0], "comparison", str(exc)))
        return tuple(diagnostics)

    if role == SemanticRole.PREDICATE and axes:
        diagnostics.append(SemanticDiagnostic(
            "requires_scalar_predicate", "comparison",
            "A Predicate must resolve to scalar Truth; reduce Asset/Time explicitly.",
        ))
    return tuple(diagnostics)


def condition_limits(condition: ConditionV2) -> tuple[int, int, int]:
    """Return depth, boolean child maximum, and total nodes."""

    if isinstance(condition, ComparisonV2):
        return 1, 0, 1
    if isinstance(condition, NotConditionV2):
        depth, width, total = condition_limits(condition.child)
        return depth + 1, width, total + 1
    children = [condition_limits(child) for child in condition.children]
    return 1 + max(item[0] for item in children), max(len(condition.children), *(item[1] for item in children)), 1 + sum(item[2] for item in children)


def validate_condition(
    condition: ConditionV2,
    role: SemanticRole,
    *,
    bound_candidate_id: str | None,
) -> tuple[SemanticDiagnostic, ...]:
    depth, width, total = condition_limits(condition)
    diagnostics: list[SemanticDiagnostic] = []
    if depth > 4:
        diagnostics.append(SemanticDiagnostic("condition_depth_limit", "condition", "Boolean conditions support at most four nested levels."))
    if width > 12:
        diagnostics.append(SemanticDiagnostic("condition_width_limit", "condition", "A Boolean group supports at most twelve clauses."))
    if total > 40:
        diagnostics.append(SemanticDiagnostic("condition_node_limit", "condition", "A Condition supports at most forty nodes."))
    if isinstance(condition, ComparisonV2):
        diagnostics.extend(validate_comparison(condition, role, bound_candidate_id=bound_candidate_id))
    elif isinstance(condition, BooleanGroupV2):
        for child in condition.children:
            diagnostics.extend(validate_condition(child, role, bound_candidate_id=bound_candidate_id))
    else:
        diagnostics.extend(validate_condition(condition.child, role, bound_candidate_id=bound_candidate_id))
    return tuple(diagnostics)


def validate_strategy_v2(strategy: CanonicalStrategyV2) -> tuple[SemanticDiagnostic, ...]:
    diagnostics: list[SemanticDiagnostic] = []
    selection = strategy.selection
    if selection.eligibility is not None:
        diagnostics.extend(validate_condition(
            selection.eligibility, SemanticRole.ELIGIBILITY,
            bound_candidate_id=selection.binding.id,
        ))
    if strategy.predicate is not None:
        diagnostics.extend(validate_condition(
            strategy.predicate, SemanticRole.PREDICATE, bound_candidate_id=None,
        ))
    try:
        rank_type = infer_value_type(selection.ranking, binding_id=selection.binding.id)
    except (SemanticTypeError, ValueError) as exc:
        diagnostics.append(SemanticDiagnostic(str(exc).split(":", 1)[0], "selection.ranking", str(exc)))
    else:
        if rank_type.dtype not in {SemanticDType.DECIMAL, SemanticDType.INTEGER} or rank_type.axes:
            diagnostics.append(SemanticDiagnostic(
                "ranking_not_comparable", "selection.ranking",
                "Ranking must yield one comparable scalar per Candidate.",
            ))
    group_ids = {group.id for group in strategy.definitions.groups}
    asset_set_ids = {item.id for item in strategy.definitions.asset_sets}
    if selection.universe_id not in group_ids | asset_set_ids:
        diagnostics.append(SemanticDiagnostic(
            "unknown_selection_universe", "selection.universe_id",
            "Selection FROM must reference an explicit AssetSet or static Group.",
        ))
    return tuple(diagnostics)


def requirements_for_strategy(strategy: CanonicalStrategyV2) -> HistoryRequirement:
    requirements = [_history_requirement(strategy.selection.ranking)]

    def visit(condition: ConditionV2) -> None:
        if isinstance(condition, ComparisonV2):
            requirements.extend((_history_requirement(condition.left), _history_requirement(condition.right)))
        elif isinstance(condition, BooleanGroupV2):
            for child in condition.children:
                visit(child)
        else:
            visit(condition.child)

    if strategy.selection.eligibility is not None:
        visit(strategy.selection.eligibility)
    if strategy.predicate is not None:
        visit(strategy.predicate)
    return HistoryRequirement(max(item.minimum_history_lower_bound for item in requirements))


def v2_capabilities() -> dict[str, OperationCapability]:
    """Truthful Profile-A capability ledger.

    The adjusted-close roots below passed the pinned reference-vs-Docker-LEAN
    differential. They remain non-production-ready because v2 authoring is not
    exposed. Provider-limited fields and reference-only composition stay
    explicitly unverified.
    """

    verified_adjusted_close = OperationCapability(
        parseable=True,
        type_valid=True,
        role_valid=True,
        provider_available=True,
        historical_safe=True,
        reference_evaluable=True,
        backend_lowerable=True,
        authoring_reachable=True,
        verified_profile=True,
    )
    reference_only = OperationCapability(
        parseable=True,
        type_valid=True,
        role_valid=True,
        provider_available=True,
        historical_safe=True,
        reference_evaluable=True,
        backend_lowerable=False,
        authoring_reachable=False,
        verified_profile=False,
    )
    provider_blocked = OperationCapability(
        parseable=True,
        type_valid=True,
        role_valid=True,
        provider_available=False,
        historical_safe=False,
        reference_evaluable=True,
        backend_lowerable=False,
        authoring_reachable=False,
        verified_profile=False,
    )
    return {
        # Existing v2 Canonical bridge aliases.
        "candidate.trailing_return": verified_adjusted_close,
        "candidate.current_price": verified_adjusted_close,
        # DailyValue operator profiles verified against the maintained runtime.
        "daily.adjusted_close@1": verified_adjusted_close,
        "daily.trailing_return@1": verified_adjusted_close,
        "daily.sma@1": verified_adjusted_close,
        "daily.ema@1": verified_adjusted_close,
        "daily.rsi_wilder_lean_compat@1": verified_adjusted_close,
        "daily.realized_volatility@1": verified_adjusted_close,
        # Typed reference composition does not yet have general LEAN lowering.
        "daily.history@1": reference_only,
        "daily.reduce.asset@1": reference_only,
        "daily.reduce.time@1": reference_only,
        "daily.arithmetic@1": reference_only,
        "daily.absolute@1": reference_only,
        "daily.comparison_truth@1": reference_only,
        # The maintained provider exposes neither these fields nor PIT identity.
        "daily.raw_ohlc@1": provider_blocked,
        "daily.volume_raw_shares@1": provider_blocked,
        "daily.pit_membership@1": provider_blocked,
        # The old unversioned indicator token remains intentionally invalid;
        # only the explicit DailyValue Wilder compatibility profile is verified.
        "indicator.rsi": OperationCapability(
            parseable=False,
            type_valid=False,
            role_valid=False,
            provider_available=False,
            historical_safe=False,
            reference_evaluable=False,
            backend_lowerable=False,
            authoring_reachable=False,
            verified_profile=False,
        ),
    }

