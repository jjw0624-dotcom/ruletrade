from __future__ import annotations

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
    UnsupportedStrategyError,
)
from ruletrade.backtests.models import (
    BacktestConfig,
    BacktestTimings,
    LeanBacktestRequest,
    LeanBacktestResponse,
)
from ruletrade.backtests.service import BacktestService
from ruletrade.persistence.sqlite_backtest_runs import SQLiteBacktestRunRepository
from ruletrade.strategies.service import StrategyService


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

    def create_and_execute(
        self,
        revision_id: str,
        config: BacktestConfig | Mapping[str, Any],
    ) -> BacktestRunRecord:
        run_config = self._validate_config(config)
        total_started = perf_counter_ns()
        source_started = perf_counter_ns()
        revision = self.strategies.get_revision_by_id(revision_id)
        source_load_ms = _elapsed_ms(source_started)
        now = self._clock()
        run = BacktestRunRecord(
            id=self._id_factory(),
            revision_id=revision.id,
            status=BacktestRunStatus.PENDING,
            run_config=run_config,
            provenance=BacktestRunProvenance(
                source_hash=revision.source_hash,
                strategy_schema_version=revision.schema_version,
                application_version=__version__,
                build_commit=self._build_commit,
                engine_image=self.executor.engine_image,
                dataset_id=run_config.dataset_id,
            ),
            timings=BacktestTimings(source_load_ms=source_load_ms),
            created_at=now,
        )
        self.repository.create_run(run)
        running = self.repository.mark_running(run.id, self._clock())
        try:
            response = self.executor.execute(
                LeanBacktestRequest(strategy=revision.canonical_strategy, config=run_config)
            )
        except BacktestError as exc:
            timings = BacktestTimings(
                source_load_ms=source_load_ms,
                total_ms=_elapsed_ms(total_started),
            )
            return self.repository.complete_failed(
                running.id,
                self._public_error(exc),
                timings,
                self._clock(),
            )

        timings = response.timings.model_copy(
            update={
                "source_load_ms": source_load_ms,
                "total_ms": _elapsed_ms(total_started),
            }
        )
        return self.repository.complete_succeeded(
            running.id,
            response.result,
            timings,
            self._clock(),
        )

    def list_runs(self, revision_id: str) -> tuple[BacktestRunRecord, ...]:
        self.strategies.get_revision_by_id(revision_id)
        return self.repository.list_runs(revision_id)

    def get_run(self, run_id: str) -> BacktestRunRecord:
        run = self.repository.get_run(run_id)
        if run is None:
            raise BacktestRunNotFoundError("Backtest Run was not found.")
        return run

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
    def _public_error(exc: BacktestError) -> BacktestRunError:
        if isinstance(exc, LeanRuntimeUnavailableError):
            return BacktestRunError(code=exc.code, message=str(exc))
        if isinstance(exc, UnsupportedStrategyError):
            return BacktestRunError(code=exc.code, message=str(exc))
        if isinstance(exc, InvalidStrategyError):
            return BacktestRunError(
                code="invalid_strategy_source",
                message="Stored Strategy source failed validation.",
            )
        if isinstance(exc, (LeanExecutionError, MalformedLeanResultError)):
            return BacktestRunError(
                code="execution_failure",
                message="Backtest execution failed.",
            )
        return BacktestRunError(code="execution_failure", message="Backtest execution failed.")


def _elapsed_ms(started_ns: int) -> int:
    return max(0, (perf_counter_ns() - started_ns) // 1_000_000)
