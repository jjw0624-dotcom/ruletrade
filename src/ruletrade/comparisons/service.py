from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from time import perf_counter_ns
from typing import Any
from uuid import uuid4

from ruletrade.backtest_runs.models import BacktestRunRecord, BacktestRunStatus
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.candidates.service import CandidateService
from ruletrade.comparisons.errors import (
    ComparisonEvidenceUnsupportedError,
    ComparisonNotFoundError,
    IncomparableRunsError,
)
from ruletrade.comparisons.models import (
    BehaviorDifference,
    BehaviorDifferenceKind,
    ComparisonRecord,
    DecimalMetricDiff,
    DecisionContextDiff,
    FirstDifference,
    IntegerMetricDiff,
    ResultDiff,
    StrategyDiff,
)
from ruletrade.decision_evidence.models import DecisionEventDetail
from ruletrade.persistence.sqlite_comparisons import SQLiteComparisonRepository

_PHASE_ORDER = {
    "evaluation": 0,
    "selection": 1,
    "snapshot_commit": 2,
    "portfolio_execution": 3,
    "state_mutation": 4,
}
_KIND_ORDER = {
    "filter": 0,
    "random_selection": 1,
    "selection": 1,
    "cooldown": 2,
    "fallback": 3,
    "final_selection": 4,
    "snapshot_refresh": 5,
    "snapshot_usage": 6,
    "sleeve_contribution": 7,
    "final_targets": 8,
    "state_mutation": 9,
}


class ComparisonService:
    """Derives and persists comparisons from immutable product artifacts."""

    def __init__(
        self,
        repository: SQLiteComparisonRepository,
        candidates: CandidateService,
        runs: BacktestRunService,
        *,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self.candidates = candidates
        self.runs = runs
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid4()))

    def create(self, candidate_id: str) -> ComparisonRecord:
        existing = self.repository.get_for_candidate(candidate_id)
        if existing is not None:
            return existing
        started = perf_counter_ns()
        execution = self.candidates.get(candidate_id)
        candidate = execution.candidate
        candidate_run = execution.run
        if candidate.originating_run_id is None:
            raise IncomparableRunsError("Candidate has no originating Run.")
        original_run = self.runs.get_run(candidate.originating_run_id)
        base_revision = self.candidates.strategies.get_revision_by_id(
            candidate.base_revision_id
        )
        self._validate_pair(
            candidate.base_revision_id,
            base_revision.source_hash,
            candidate.source_hash,
            original_run,
            candidate_run,
            candidate.id,
        )
        original_events = self._events(original_run.id)
        candidate_events = self._events(candidate_run.id)
        contexts, aligned_count = align_decision_evidence(original_events, candidate_events)
        first = None
        if contexts:
            first = FirstDifference(
                session_id=contexts[0].session_id,
                difference_key=contexts[0].differences[0].key,
            )
        comparison = ComparisonRecord(
            id=self._id_factory(),
            candidate_id=candidate.id,
            original_run_id=original_run.id,
            candidate_run_id=candidate_run.id,
            strategy_diff=StrategyDiff(
                component_id=candidate.change.component_id,
                field_path=candidate.change.field_path,
                before=candidate.change.expected_before,
                after=candidate.change.proposed_after,
            ),
            aligned_evidence_records=aligned_count,
            changed_decision_contexts=contexts,
            first_difference=first,
            result_diff=_result_diff(original_run, candidate_run),
            compute_ms=max(0, (perf_counter_ns() - started) // 1_000_000),
            created_at=self._clock(),
        )
        self.repository.create(comparison)
        return comparison

    def get(self, comparison_id: str) -> ComparisonRecord:
        comparison = self.repository.get(comparison_id)
        if comparison is None:
            raise ComparisonNotFoundError("Comparison was not found.")
        return comparison

    def _events(self, run_id: str) -> tuple[DecisionEventDetail, ...]:
        events = self.runs.list_decision_event_details(run_id)
        if not events:
            raise ComparisonEvidenceUnsupportedError(
                "Comparison requires persisted Decision Evidence."
            )
        if any(event.schema_version != 2 for event in events):
            raise ComparisonEvidenceUnsupportedError(
                "Behavior Comparison requires Decision Evidence v2."
            )
        return events

    @staticmethod
    def _validate_pair(
        base_revision_id: str,
        base_source_hash: str,
        candidate_source_hash: str,
        original: BacktestRunRecord,
        candidate: BacktestRunRecord,
        candidate_id: str,
    ) -> None:
        if original.candidate_id is not None:
            raise IncomparableRunsError("Original Run must be Revision-backed.")
        if candidate.candidate_id != candidate_id:
            raise IncomparableRunsError("Candidate Run does not belong to Candidate.")
        if original.revision_id != base_revision_id or candidate.revision_id != base_revision_id:
            raise IncomparableRunsError("Run Revision lineage does not match Candidate base.")
        if original.provenance.source_hash != base_source_hash:
            raise IncomparableRunsError("Original Run source does not match base Revision.")
        if candidate.provenance.source_hash != candidate_source_hash:
            raise IncomparableRunsError("Candidate Run source does not match Candidate.")
        if original.run_config != candidate.run_config:
            raise IncomparableRunsError("Run configurations are not exactly equal.")
        if (
            original.status != BacktestRunStatus.SUCCEEDED
            or candidate.status != BacktestRunStatus.SUCCEEDED
        ):
            raise IncomparableRunsError("Behavior and Result Comparison requires succeeded Runs.")
        if original.result is None or candidate.result is None:
            raise IncomparableRunsError("Succeeded Runs require normalized Results.")


def align_decision_evidence(
    original_events: tuple[DecisionEventDetail, ...],
    candidate_events: tuple[DecisionEventDetail, ...],
) -> tuple[tuple[DecisionContextDiff, ...], int]:
    """Align by semantic context, never by global evidence ordinal."""

    original = _index_events(original_events)
    candidate = _index_events(candidate_events)
    keys = sorted(set(original) | set(candidate), key=_alignment_sort_key)
    by_session: dict[date, list[BehaviorDifference]] = defaultdict(list)
    for key in keys:
        before = original.get(key)
        after = candidate.get(key)
        if before is not None and after is not None:
            kinds = _classify(before, after)
            if not kinds:
                continue
            presence = "both"
        else:
            kinds = _presence_change_kinds(before or after)
            presence = "original_only" if before is not None else "candidate_only"
        event = before or after
        assert event is not None
        by_session[event.session_id].append(
            BehaviorDifference(
                key=_key_text(key),
                presence=presence,
                kinds=kinds,
                original_event=before,
                candidate_event=after,
            )
        )
    contexts = tuple(
        DecisionContextDiff(session_id=session, differences=tuple(by_session[session]))
        for session in sorted(by_session)
    )
    return contexts, len(keys)


def _index_events(
    events: tuple[DecisionEventDetail, ...],
) -> dict[tuple[Any, ...], DecisionEventDetail]:
    counts: dict[tuple[Any, ...], int] = defaultdict(int)
    indexed: dict[tuple[Any, ...], DecisionEventDetail] = {}
    for event in sorted(events, key=lambda item: item.ordinal):
        base = (
            event.session_id,
            event.phase,
            event.kind,
            tuple(
                sorted(
                    (ref.role, ref.component_id, ref.field_path or "")
                    for ref in event.source_components
                )
            ),
            _subject(event),
        )
        counts[base] += 1
        indexed[(*base, counts[base])] = event
    return indexed


def _subject(event: DecisionEventDetail) -> str:
    evidence = event.evidence
    if evidence.kind in {"fallback", "cooldown", "state_mutation"}:
        return evidence.asset
    return ""


def _classify(
    before: DecisionEventDetail,
    after: DecisionEventDetail,
) -> tuple[BehaviorDifferenceKind, ...]:
    left = before.evidence
    right = after.evidence
    if left.kind != right.kind:
        return ("event_presence_changed",)
    kinds: list[BehaviorDifferenceKind] = []
    if left.kind == "filter" and right.kind == "filter":
        left_pass = {item.asset: item.passed for item in left.evaluations}
        right_pass = {item.asset: item.passed for item in right.evaluations}
        if left_pass != right_pass or left.decision_universe != right.decision_universe:
            kinds.append("qualification_changed")
    elif left.kind == "selection" and right.kind == "selection":
        if left.ranked != right.ranked:
            kinds.append("rank_changed")
        if left.candidates != right.candidates:
            kinds.append("candidate_membership_changed")
        if left.primary_selected != right.primary_selected or left.decision != right.decision:
            kinds.append("primary_selection_changed")
    elif left.kind == "random_selection" and right.kind == "random_selection":
        if left.selected != right.selected:
            kinds.append("primary_selection_changed")
    elif left.kind == "fallback" and right.kind == "fallback":
        if left.activated != right.activated or left.asset != right.asset:
            kinds.append("fallback_activation_changed")
    elif left.kind == "cooldown" and right.kind == "cooldown":
        if left.signal_candidate != right.signal_candidate or left.eligible != right.eligible:
            kinds.append("cooldown_eligibility_changed")
    elif left.kind == "final_selection" and right.kind == "final_selection":
        if left.selected != right.selected or left.source != right.source:
            kinds.append("final_selection_changed")
    elif left.kind == "snapshot_refresh" and right.kind == "snapshot_refresh":
        if left.local_targets != right.local_targets:
            kinds.append("snapshot_targets_changed")
    elif left.kind == "snapshot_usage" and right.kind == "snapshot_usage":
        if left.snapshots != right.snapshots or left.executed != right.executed:
            kinds.append("snapshot_usage_changed")
    elif left.kind == "sleeve_contribution" and right.kind == "sleeve_contribution":
        if (
            left.local_selected != right.local_selected
            or left.local_targets != right.local_targets
            or left.scaled_targets != right.scaled_targets
        ):
            kinds.append("sleeve_contribution_changed")
    elif left.kind == "state_mutation" and right.kind == "state_mutation":
        if left != right:
            kinds.append("state_mutation_changed")
    elif left.kind == "final_targets" and right.kind == "final_targets":
        if left.selected != right.selected or left.targets != right.targets:
            kinds.append("final_target_changed")
    return tuple(kinds)


def _presence_change_kinds(
    event: DecisionEventDetail | None,
) -> tuple[BehaviorDifferenceKind, ...]:
    assert event is not None
    semantic_kind: dict[str, BehaviorDifferenceKind] = {
        "filter": "qualification_changed",
        "selection": "primary_selection_changed",
        "random_selection": "primary_selection_changed",
        "fallback": "fallback_activation_changed",
        "cooldown": "cooldown_eligibility_changed",
        "final_selection": "final_selection_changed",
        "snapshot_refresh": "snapshot_targets_changed",
        "snapshot_usage": "snapshot_usage_changed",
        "sleeve_contribution": "sleeve_contribution_changed",
        "state_mutation": "state_mutation_changed",
        "final_targets": "final_target_changed",
    }
    classified = semantic_kind.get(event.kind)
    return (
        ("event_presence_changed",)
        if classified is None
        else ("event_presence_changed", classified)
    )


def _result_diff(original: BacktestRunRecord, candidate: BacktestRunRecord) -> ResultDiff:
    assert original.result is not None and candidate.result is not None
    left = original.result
    right = candidate.result
    return ResultDiff(
        initial_value=_decimal_metric(left.initial_value, right.initial_value),
        final_value=_decimal_metric(left.final_value, right.final_value),
        total_return=_decimal_metric(left.total_return, right.total_return),
        total_orders=IntegerMetricDiff(
            original=left.total_orders,
            candidate=right.total_orders,
            delta=right.total_orders - left.total_orders,
        ),
        total_fees=_decimal_metric(left.total_fees, right.total_fees),
        original_equity_run_id=original.id,
        candidate_equity_run_id=candidate.id,
    )


def _decimal_metric(original: Decimal, candidate: Decimal) -> DecimalMetricDiff:
    return DecimalMetricDiff(
        original=original,
        candidate=candidate,
        delta=candidate - original,
    )


def _alignment_sort_key(key: tuple[Any, ...]) -> tuple[Any, ...]:
    return (
        key[0],
        _PHASE_ORDER[key[1]],
        _KIND_ORDER[key[2]],
        key[3],
        key[4],
        key[5],
    )


def _key_text(key: tuple[Any, ...]) -> str:
    sources = ",".join(f"{role}:{component}:{field}" for role, component, field in key[3])
    return f"{key[0].isoformat()}|{key[1]}|{key[2]}|{sources}|{key[4]}|{key[5]}"
