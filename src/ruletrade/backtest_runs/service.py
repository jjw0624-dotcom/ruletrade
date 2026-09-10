from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from time import perf_counter_ns
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from ruletrade import __version__
from ruletrade.backtest_runs.errors import (
    BacktestRunNotFoundError,
    BacktestRunPersistenceError,
    InvalidRunConfigError,
    RunConfigIssue,
)
from ruletrade.backtest_runs.models import (
    BacktestRunError,
    BacktestRunProvenance,
    BacktestRunRecord,
    BacktestRunStatus,
)
from ruletrade.backtests.errors import (
    BacktestError,
    InvalidStrategyError,
    LeanExecutionError,
    LeanRuntimeUnavailableError,
    MalformedLeanResultError,
    MarketDataUnavailableError,
    UnsupportedStrategyError,
)
from ruletrade.backtests.models import (
    BacktestConfig,
    BacktestDiagnostics,
    BacktestTimings,
    LeanBacktestRequest,
    LeanBacktestResponse,
)
from ruletrade.backtests.service import BacktestService
from ruletrade.decision_evidence.errors import (
    DecisionEventNotFoundError,
    DecisionEvidenceError,
)
from ruletrade.decision_evidence.models import DecisionEventDetail, DecisionEventSummary
from ruletrade.diagnostics import elapsed_ms
from ruletrade.market_data.models import MarketDataPreflight
from ruletrade.persistence.sqlite_backtest_runs import SQLiteBacktestRunRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.models import CanonicalStrategyV1

logger = logging.getLogger(__name__)


class BacktestRunService:
    """Owns persisted Run lifecycle while reusing one LEAN execution core."""

    def __init__(
        self,
        repository: SQLiteBacktestRunRepository,
        strategies: StrategyService,
        executor: BacktestService,
        *,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
        build_commit: str | None = None,
    ) -> None:
        self.repository = repository
        self.strategies = strategies
        self.executor = executor
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid4()))
        configured_commit = build_commit if build_commit is not None else os.getenv("RULETRADE_BUILD_COMMIT")
        self._build_commit = configured_commit or None

    def execute_transient(self, request: LeanBacktestRequest) -> LeanBacktestResponse:
        """Compatibility path for an explicitly unsaved editor working copy."""

        return self.executor.execute(request)

    def preflight(
        self,
        revision_id: str,
        config: BacktestConfig | Mapping[str, Any],
    ) -> MarketDataPreflight:
        run_config = self._validate_config(config)
        revision = self.strategies.get_revision_by_id(revision_id)
        if self.executor.market_data is None:
            raise RuntimeError("Market-data preflight is not configured.")
        return self.executor.market_data.preflight(revision.canonical_strategy, run_config)

    def create_and_execute(
        self,
        revision_id: str,
        config: BacktestConfig | Mapping[str, Any],
    ) -> BacktestRunRecord:
        run_config = self._validate_config(config)
        total_started = perf_counter_ns()
        source_started = perf_counter_ns()
        revision = self.strategies.get_revision_by_id(revision_id)
        source_load_ms = elapsed_ms(source_started)
        return self._create_and_execute_source(
            revision_id=revision.id,
            candidate_id=None,
            canonical=revision.canonical_strategy,
            source_hash=revision.source_hash,
            schema_version=revision.schema_version,
            run_config=run_config,
            source_load_ms=source_load_ms,
            total_started=total_started,
        )

    def create_and_execute_candidate(
        self,
        *,
        candidate_id: str,
        base_revision_id: str,
        canonical: CanonicalStrategyV1,
        source_hash: str,
        schema_version: str,
        config: BacktestConfig,
    ) -> BacktestRunRecord:
        """Execute an immutable Candidate through the same official Run pipeline."""

        total_started = perf_counter_ns()
        return self._create_and_execute_source(
            revision_id=base_revision_id,
            candidate_id=candidate_id,
            canonical=canonical,
            source_hash=source_hash,
            schema_version=schema_version,
            run_config=self._validate_config(config),
            source_load_ms=0,
            total_started=total_started,
        )

    def _create_and_execute_source(
        self,
        *,
        revision_id: str,
        candidate_id: str | None,
        canonical: CanonicalStrategyV1,
        source_hash: str,
        schema_version: str,
        run_config: BacktestConfig,
        source_load_ms: int,
        total_started: int,
    ) -> BacktestRunRecord:
        now = self._clock()
        preflight = (
            self.executor.market_data.preflight(canonical, run_config)
            if self.executor.market_data is not None
            else None
        )
        run = BacktestRunRecord(
            id=self._id_factory(),
            revision_id=revision_id,
            candidate_id=candidate_id,
            status=BacktestRunStatus.PENDING,
            run_config=run_config,
            provenance=BacktestRunProvenance(
                source_hash=source_hash,
                strategy_schema_version=schema_version,
                application_version=__version__,
                build_commit=self._build_commit,
                engine_image=self.executor.engine_image,
                dataset_id=run_config.dataset_id,
                market_data_provider_id=preflight.provider_id if preflight else None,
                market_data_source_kind=preflight.source_kind if preflight else None,
                data_normalization_mode=(
                    preflight.requirement.normalization_mode if preflight else None
                ),
                requested_symbols=(
                    tuple(item.symbol for item in preflight.symbols) if preflight else ()
                ),
                available_coverage=(
                    {
                        item.symbol: (item.available_from, item.available_to)
                        for item in preflight.symbols
                    }
                    if preflight
                    else {}
                ),
            ),
            timings=BacktestTimings(source_load_ms=source_load_ms),
            diagnostics=BacktestDiagnostics(
                canonical_bytes=len(canonical.model_dump_json().encode("utf-8"))
            ),
            created_at=now,
        )
        self.repository.create_run(run)
        logger.info(
            "backtest_run_created",
            extra={"run_id": run.id, "source_kind": "candidate" if candidate_id else "revision"},
        )
        running = self.repository.mark_running(run.id, self._clock())
        try:
            execution = self.executor.execute_with_evidence(
                LeanBacktestRequest(strategy=canonical, config=run_config)
            )
            evidence_validation_started = perf_counter_ns()
            if not execution.decision_events:
                raise DecisionEvidenceError("Successful execution emitted no Decision Evidence.")
            source_component_ids = {
                component.id for component in canonical.graph.components
            }
            unknown_provenance = sorted(
                {
                    reference.component_id
                    for event in execution.decision_events
                    for reference in event.source_components
                }
                - source_component_ids
            )
            if unknown_provenance:
                raise DecisionEvidenceError(
                    "Decision Evidence referenced unknown source components: "
                    + ", ".join(unknown_provenance)
                )
            evidence_validation_ms = elapsed_ms(evidence_validation_started)
        except (BacktestError, DecisionEvidenceError) as exc:
            timings = BacktestTimings(
                source_load_ms=source_load_ms,
                total_ms=elapsed_ms(total_started),
            )
            return self.repository.complete_failed(
                running.id,
                self._public_error(exc),
                timings,
                self._clock(),
            )

        response = execution.response
        timings = response.timings.model_copy(
            update={
                "source_load_ms": source_load_ms,
                "evidence_validation_ms": evidence_validation_ms,
                "total_ms": max(
                    elapsed_ms(total_started),
                    response.timings.total_ms + source_load_ms + evidence_validation_ms,
                ),
            }
        )
        try:
            completed = self.repository.complete_succeeded_with_evidence(
                running.id,
                response.result,
                timings,
                self._clock(),
                execution.decision_events,
                response.diagnostics,
            )
            logger.info(
                "backtest_run_succeeded",
                extra={
                    "run_id": completed.id,
                    "total_ms": completed.timings.total_ms,
                    "evidence_events": completed.diagnostics.evidence_events,
                },
            )
            return completed
        except BacktestRunPersistenceError as exc:
            try:
                return self.repository.complete_failed(
                    running.id,
                    BacktestRunError(
                        code="evidence_persistence_failure",
                        message="Backtest Decision Evidence could not be persisted.",
                    ),
                    timings,
                    self._clock(),
                )
            except BacktestRunPersistenceError:
                raise exc

    def list_runs(self, revision_id: str) -> tuple[BacktestRunRecord, ...]:
        self.strategies.get_revision_by_id(revision_id)
        return self.repository.list_runs(revision_id)

    def get_run(self, run_id: str) -> BacktestRunRecord:
        run = self.repository.get_run(run_id)
        if run is None:
            raise BacktestRunNotFoundError("Backtest Run was not found.")
        return run

    def get_candidate_run(self, candidate_id: str) -> BacktestRunRecord | None:
        return self.repository.get_candidate_run(candidate_id)

    def list_decision_events(self, run_id: str) -> tuple[DecisionEventSummary, ...]:
        self.get_run(run_id)
        return self.repository.list_decision_events(run_id)

    def get_decision_event(self, run_id: str, event_id: str) -> DecisionEventDetail:
        self.get_run(run_id)
        event = self.repository.get_decision_event(run_id, event_id)
        if event is None:
            raise DecisionEventNotFoundError("Decision Event was not found.")
        return event

    def list_decision_event_details(
        self, run_id: str
    ) -> tuple[DecisionEventDetail, ...]:
        return tuple(
            self.get_decision_event(run_id, event.id)
            for event in self.list_decision_events(run_id)
        )

    @staticmethod
    def _validate_config(config: BacktestConfig | Mapping[str, Any]) -> BacktestConfig:
        try:
            return config if isinstance(config, BacktestConfig) else BacktestConfig.model_validate(config)
        except ValidationError as exc:
            issues = tuple(
                RunConfigIssue(
                    path=".".join(str(item) for item in error["loc"]),
                    message=error["msg"],
                )
                for error in exc.errors(include_url=False)
            )
            raise InvalidRunConfigError(issues) from exc

    @staticmethod
    def _public_error(exc: BacktestError | DecisionEvidenceError) -> BacktestRunError:
        if isinstance(exc, DecisionEvidenceError):
            return BacktestRunError(
                code="evidence_collection_failure",
                message="Backtest Decision Evidence could not be recorded.",
            )
        if isinstance(exc, LeanRuntimeUnavailableError):
            return BacktestRunError(code=exc.code, message=str(exc))
        if isinstance(exc, UnsupportedStrategyError):
            return BacktestRunError(code=exc.code, message=str(exc))
        if isinstance(exc, InvalidStrategyError):
            return BacktestRunError(
                code="invalid_strategy_source",
                message="Stored Strategy source failed validation.",
            )
        if isinstance(exc, MarketDataUnavailableError):
            return BacktestRunError(code=exc.code, message=str(exc))
        if isinstance(exc, (LeanExecutionError, MalformedLeanResultError)):
            return BacktestRunError(
                code="execution_failure",
                message="Backtest execution failed.",
            )
        return BacktestRunError(code="execution_failure", message="Backtest execution failed.")
