from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.candidates.errors import (
    CandidateArchivedStrategyError,
    CandidateExpectedValueMismatchError,
    CandidateNotFoundError,
    InvalidCandidateChangeError,
)
from ruletrade.candidates.models import (
    CandidateExecution,
    CandidateRecord,
    FilterThresholdChange,
)
from ruletrade.hashing import strategy_hash
from ruletrade.persistence.sqlite_candidates import SQLiteCandidateRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.models import CanonicalStrategyV1


class CandidateService:
    """Owns the one-change Candidate contract and delegates execution."""

    def __init__(
        self,
        repository: SQLiteCandidateRepository,
        strategies: StrategyService,
        runs: BacktestRunService,
        *,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self.strategies = strategies
        self.runs = runs
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid4()))

    def create_and_execute(
        self,
        originating_run_id: str,
        change: FilterThresholdChange,
        *,
        originating_decision_event_id: str | None = None,
    ) -> CandidateExecution:
        origin = self.runs.get_run(originating_run_id)
        if origin.candidate_id is not None:
            raise InvalidCandidateChangeError(
                "Candidate v0 must originate from a Revision-backed Run."
            )
        revision = self.strategies.get_revision_by_id(origin.revision_id)
        strategy = self.strategies.get_strategy(revision.strategy_id).strategy
        if strategy.archived_at is not None:
            raise CandidateArchivedStrategyError(
                "New Candidates cannot be created for an archived Strategy."
            )
        if originating_decision_event_id is not None:
            event = self.runs.get_decision_event(
                originating_run_id, originating_decision_event_id
            )
            if not any(
                ref.component_id == change.component_id
                and ref.field_path == change.field_path
                for ref in event.source_components
            ):
                raise InvalidCandidateChangeError(
                    "The Decision Event does not identify the requested Strategy field."
                )

        canonical = self._apply_filter_threshold(revision.canonical_strategy, change)
        canonical = self.strategies.validate_source(canonical)
        candidate = CandidateRecord(
            id=self._id_factory(),
            base_revision_id=revision.id,
            originating_run_id=origin.id,
            originating_decision_event_id=originating_decision_event_id,
            change=change,
            canonical_strategy=canonical,
            source_hash=strategy_hash(canonical),
            schema_version=canonical.api_version,
            created_at=self._clock(),
        )
        self.repository.create(candidate)
        run = self.runs.create_and_execute_candidate(
            candidate_id=candidate.id,
            base_revision_id=candidate.base_revision_id,
            canonical=candidate.canonical_strategy,
            source_hash=candidate.source_hash,
            schema_version=candidate.schema_version,
            config=origin.run_config,
        )
        return CandidateExecution(candidate=candidate, run=run)

    def get(self, candidate_id: str) -> CandidateExecution:
        candidate = self.repository.get(candidate_id)
        if candidate is None:
            raise CandidateNotFoundError("Candidate was not found.")
        run = self.runs.get_candidate_run(candidate.id)
        if run is None:
            raise CandidateNotFoundError("Candidate Run was not found.")
        return CandidateExecution(candidate=candidate, run=run)

    def list_for_run(self, run_id: str) -> tuple[CandidateExecution, ...]:
        self.runs.get_run(run_id)
        return tuple(self.get(candidate.id) for candidate in self.repository.list_for_run(run_id))

    @staticmethod
    def _apply_filter_threshold(
        source: CanonicalStrategyV1,
        change: FilterThresholdChange,
    ) -> CanonicalStrategyV1:
        if not change.expected_before.is_finite() or not change.proposed_after.is_finite():
            raise InvalidCandidateChangeError("Candidate values must be finite numbers.")
        components = list(source.graph.components)
        index = next(
            (i for i, component in enumerate(components) if component.id == change.component_id),
            None,
        )
        if index is None:
            raise InvalidCandidateChangeError("Candidate component was not found.")
        component = components[index]
        if component.primitive != "filter@1" or change.field_path != "config.threshold":
            raise InvalidCandidateChangeError(
                "Candidate v0 supports only filter@1 config.threshold."
            )
        current = component.config.get("threshold")
        try:
            current_decimal = Decimal(str(current))
        except (ValueError, TypeError):
            raise InvalidCandidateChangeError(
                "The filter threshold is not a valid numeric source value."
            ) from None
        if current_decimal != change.expected_before:
            raise CandidateExpectedValueMismatchError(
                "Candidate expected value does not match the immutable base Revision."
            )
        if change.proposed_after == current_decimal:
            raise InvalidCandidateChangeError("Candidate change must alter the source value.")
        # Canonical config payloads represent percentage literals as decimal strings.
        # Materialize that stored-source representation before hashing or execution so
        # the in-memory Candidate and a reopened Candidate are identical.
        updated_config = {**component.config, "threshold": str(change.proposed_after)}
        components[index] = component.model_copy(update={"config": updated_config})
        return source.model_copy(
            update={"graph": source.graph.model_copy(update={"components": tuple(components)})}
        )
