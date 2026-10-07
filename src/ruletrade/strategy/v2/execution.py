"""Deterministic Profile A v2 Selection execution and Evidence materialization."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueEvaluator,
    DailyValueNode,
    combine_truth,
    compare_daily_values,
)
from ruletrade.strategy.v2.models import (
    BooleanGroupV2,
    CanonicalStrategyV2,
    ComparisonV2,
    ConditionV2,
    NotConditionV2,
)
from ruletrade.strategy.v2.validation import validate_strategy_v2


class V2ExecutionError(ValueError):
    pass


@dataclass(frozen=True)
class ValueObservationEvidence:
    semantic_id: str
    candidate: str | None
    value: Decimal | None
    reason: str | None
    observed_at: str
    expression_hash: str
    operator_versions: tuple[str, ...]


@dataclass(frozen=True)
class ComparisonEvidenceV2:
    semantic_id: str
    candidate: str | None
    operator: str
    left: ValueObservationEvidence
    right: ValueObservationEvidence
    outcome: str
    reason: str | None


@dataclass(frozen=True)
class SelectionEvidenceV2:
    semantic_id: str
    universe_id: str
    requested_members: tuple[str, ...]
    eligible_members: tuple[str, ...]
    unknown_members: tuple[str, ...]
    ranked_members: tuple[str, ...]
    selected_members: tuple[str, ...]
    shortage_policy: str
    fallback_asset: str | None
    fallback_used: bool
    comparisons: tuple[ComparisonEvidenceV2, ...]
    ranking_observations: tuple[ValueObservationEvidence, ...]


@dataclass(frozen=True)
class SelectionExecutionV2:
    selected_assets: tuple[str, ...]
    complete: bool
    evidence: SelectionEvidenceV2


def _members(strategy: CanonicalStrategyV2, snapshot: DailyMarketSnapshot) -> tuple[str, ...]:
    selection = strategy.selection
    if selection is None:
        raise V2ExecutionError("compatibility_selection_missing")
    if selection.universe_id in snapshot.domains:
        return snapshot.domains[selection.universe_id]
    group = next((item for item in strategy.definitions.groups if item.id == selection.universe_id), None)
    asset_set_id = group.asset_set_ref if group else selection.universe_id
    asset_set = next((item for item in strategy.definitions.asset_sets if item.id == asset_set_id), None)
    if asset_set is None:
        raise V2ExecutionError("selection_universe_unavailable")
    return tuple(asset_set.assets)


def _observation(node: DailyValueNode, evaluator: DailyValueEvaluator, candidate: str | None, binding_id: str | None) -> tuple[object, ValueObservationEvidence]:
    result = evaluator.evaluate(node, candidate=candidate, binding_id=binding_id)
    if result.axes:
        raise V2ExecutionError("selection_value_must_be_candidate_scalar")
    cell = result.cells[()]
    provenance = result.provenance
    return result, ValueObservationEvidence(
        semantic_id=node.semantic_id,
        candidate=candidate,
        value=cell.value,
        reason=cell.reason,
        observed_at=result.observed_at[-1],
        expression_hash=provenance.expression_hash if provenance else node.content_hash,
        operator_versions=provenance.operator_versions if provenance else (),
    )


def _condition(
    condition: ConditionV2,
    evaluator: DailyValueEvaluator,
    candidate: str | None,
    binding_id: str | None,
) -> tuple[str, tuple[ComparisonEvidenceV2, ...]]:
    if isinstance(condition, ComparisonV2):
        if not isinstance(condition.left, DailyValueNode) or not isinstance(condition.right, DailyValueNode):
            raise V2ExecutionError("legacy_v2_bridge_value_not_supported_by_general_executor")
        left, left_evidence = _observation(condition.left, evaluator, candidate, binding_id)
        right, right_evidence = _observation(condition.right, evaluator, candidate, binding_id)
        truth = compare_daily_values(left, right, condition.operator)
        outcome = truth.values[()]
        evidence = ComparisonEvidenceV2(
            semantic_id=condition.semantic_id,
            candidate=candidate,
            operator=condition.operator,
            left=left_evidence,
            right=right_evidence,
            outcome=outcome,
            reason=truth.reasons[()],
        )
        return outcome, (evidence,)
    if isinstance(condition, NotConditionV2):
        value, evidence = _condition(condition.child, evaluator, candidate, binding_id)
        return combine_truth("not", value), evidence
    child_results = [
        _condition(child, evaluator, candidate, binding_id)
        for child in condition.children
    ]
    return (
        combine_truth(condition.kind, *(item[0] for item in child_results)),
        tuple(event for item in child_results for event in item[1]),
    )


def execute_selection_v2(
    strategy: CanonicalStrategyV2,
    snapshot: DailyMarketSnapshot,
    *,
    cutoff_index: int | None = None,
) -> SelectionExecutionV2:
    issues = validate_strategy_v2(strategy)
    if issues:
        raise V2ExecutionError("; ".join(f"{item.path}: {item.code}" for item in issues))
    selection = strategy.selection
    if selection is None:
        raise V2ExecutionError("compatibility_selection_missing; execute Semantic Program instead")
    evaluator = DailyValueEvaluator(snapshot, cutoff_index=cutoff_index)
    members = _members(strategy, snapshot)
    eligible: list[str] = []
    unknown: list[str] = []
    comparisons: list[ComparisonEvidenceV2] = []
    for member in members:
        if selection.eligibility is None:
            outcome = "true"
        else:
            outcome, events = _condition(
                selection.eligibility,
                evaluator,
                member,
                selection.binding.id,
            )
            comparisons.extend(events)
        if outcome == "true":
            eligible.append(member)
        elif outcome == "unknown":
            unknown.append(member)

    rankings: list[tuple[Decimal, str]] = []
    ranking_evidence: list[ValueObservationEvidence] = []
    if not isinstance(selection.ranking, DailyValueNode):
        raise V2ExecutionError("legacy_v2_bridge_value_not_supported_by_general_executor")
    for member in eligible:
        _result, evidence = _observation(
            selection.ranking, evaluator, member, selection.binding.id,
        )
        ranking_evidence.append(evidence)
        if evidence.value is not None:
            rankings.append((evidence.value, member))
        else:
            unknown.append(member)
    rankings.sort(key=lambda item: (item[0], item[1]), reverse=selection.direction == "descending")
    ranked_members = tuple(item[1] for item in rankings)
    complete = len(ranked_members) >= selection.count
    if complete or selection.shortage_policy == "choose_all":
        selected = ranked_members[:selection.count]
        fallback_used = False
    elif selection.fallback_asset:
        selected = (selection.fallback_asset,)
        fallback_used = True
    else:
        selected = ()
        fallback_used = False
    evidence = SelectionEvidenceV2(
        semantic_id=selection.semantic_id,
        universe_id=selection.universe_id,
        requested_members=members,
        eligible_members=tuple(eligible),
        unknown_members=tuple(dict.fromkeys(unknown)),
        ranked_members=ranked_members,
        selected_members=selected,
        shortage_policy=selection.shortage_policy,
        fallback_asset=selection.fallback_asset,
        fallback_used=fallback_used,
        comparisons=tuple(comparisons),
        ranking_observations=tuple(ranking_evidence),
    )
    return SelectionExecutionV2(selected_assets=selected, complete=complete, evidence=evidence)


def evaluate_predicate_v2(
    strategy: CanonicalStrategyV2,
    snapshot: DailyMarketSnapshot,
    *,
    cutoff_index: int | None = None,
) -> tuple[str, tuple[ComparisonEvidenceV2, ...]]:
    if strategy.predicate is None:
        return "true", ()
    evaluator = DailyValueEvaluator(snapshot, cutoff_index=cutoff_index)
    return _condition(strategy.predicate, evaluator, None, None)
