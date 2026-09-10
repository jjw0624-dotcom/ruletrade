from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from ruletrade.backtest_runs.errors import BacktestRunPersistenceError
from ruletrade.backtest_runs.models import (
    BacktestRunError,
    BacktestRunProvenance,
    BacktestRunRecord,
    BacktestRunStatus,
)
from ruletrade.backtests.models import BacktestConfig, BacktestResult, BacktestTimings
from ruletrade.decision_evidence.models import (
    CollectedDecisionEvent,
    DecisionEventDetail,
    DecisionEventSummary,
    SourceComponentRef,
)
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository


class SQLiteBacktestRunRepository:
    """SQLite mechanics for immutable Run inputs and lifecycle transitions."""

    def __init__(self, path: Path) -> None:
        self.path = path
        SQLiteStrategyRepository(path)

    def create_run(self, run: BacktestRunRecord) -> None:
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO backtest_runs (
                        id, revision_id, candidate_id, status, config_json, result_json, error_json,
                        provenance_json, timings_json, created_at, started_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL)
                    """,
                    (
                        run.id,
                        run.revision_id,
                        run.candidate_id,
                        run.status.value,
                        _model_json(run.run_config),
                        _model_json(run.provenance),
                        _model_json(run.timings),
                        _timestamp(run.created_at),
                    ),
                )
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError("Could not create Backtest Run.") from exc

    def mark_running(self, run_id: str, started_at: datetime) -> BacktestRunRecord:
        return self._transition(
            run_id,
            expected=BacktestRunStatus.PENDING,
            status=BacktestRunStatus.RUNNING,
            assignments="started_at = ?",
            values=(_timestamp(started_at),),
        )

    def complete_succeeded_with_evidence(
        self,
        run_id: str,
        result: BacktestResult,
        timings: BacktestTimings,
        completed_at: datetime,
        events: tuple[CollectedDecisionEvent, ...],
    ) -> BacktestRunRecord:
        if not events or [item.sequence for item in events] != list(
            range(1, len(events) + 1)
        ):
            raise BacktestRunPersistenceError(
                "Successful Backtest Runs require one contiguous Decision Evidence set."
            )
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                status = connection.execute(
                    "SELECT status FROM backtest_runs WHERE id = ?", (run_id,)
                ).fetchone()
                if status is None or status["status"] != BacktestRunStatus.RUNNING.value:
                    raise BacktestRunPersistenceError(
                        "Backtest Run lifecycle transition was rejected."
                    )
                for event in events:
                    event_id = f"event-{event.sequence:06d}"
                    connection.execute(
                        """
                        INSERT INTO decision_events (
                            run_id, id, ordinal, schema_version, session_id, phase, kind,
                            source_components_json, evidence_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            run_id,
                            event_id,
                            event.sequence,
                            event.schema_version,
                            event.session_id.isoformat(),
                            event.phase,
                            event.evidence.kind,
                            json.dumps(
                                [item.model_dump(mode="json") for item in event.source_components],
                                sort_keys=True,
                                separators=(",", ":"),
                            ),
                            _model_json(event.evidence),
                        ),
                    )
                cursor = connection.execute(
                    """
                    UPDATE backtest_runs
                    SET status = ?, result_json = ?, timings_json = ?, completed_at = ?
                    WHERE id = ? AND status = ?
                    """,
                    (
                        BacktestRunStatus.SUCCEEDED.value,
                        _model_json(result),
                        _model_json(timings),
                        _timestamp(completed_at),
                        run_id,
                        BacktestRunStatus.RUNNING.value,
                    ),
                )
                if cursor.rowcount != 1:
                    raise BacktestRunPersistenceError(
                        "Backtest Run lifecycle transition was rejected."
                    )
                row = connection.execute(
                    "SELECT * FROM backtest_runs WHERE id = ?", (run_id,)
                ).fetchone()
                connection.commit()
            if row is None:
                raise BacktestRunPersistenceError(
                    "Backtest Run disappeared during transition."
                )
            return self._run(row)
        except BacktestRunPersistenceError:
            raise
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError(
                "Could not persist Backtest Run Decision Evidence."
            ) from exc

    def complete_failed(
        self,
        run_id: str,
        error: BacktestRunError,
        timings: BacktestTimings,
        completed_at: datetime,
    ) -> BacktestRunRecord:
        return self._transition(
            run_id,
            expected=BacktestRunStatus.RUNNING,
            status=BacktestRunStatus.FAILED,
            assignments="error_json = ?, timings_json = ?, completed_at = ?",
            values=(_model_json(error), _model_json(timings), _timestamp(completed_at)),
        )

    def get_run(self, run_id: str) -> BacktestRunRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM backtest_runs WHERE id = ?", (run_id,)
                ).fetchone()
            return None if row is None else self._run(row)
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError("Could not read Backtest Run.") from exc

    def list_runs(self, revision_id: str) -> tuple[BacktestRunRecord, ...]:
        try:
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM backtest_runs
                    WHERE revision_id = ? AND candidate_id IS NULL
                    ORDER BY created_at DESC, id DESC
                    """,
                    (revision_id,),
                ).fetchall()
            return tuple(self._run(row) for row in rows)
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError("Could not list Backtest Runs.") from exc

    def get_candidate_run(self, candidate_id: str) -> BacktestRunRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM backtest_runs WHERE candidate_id = ?", (candidate_id,)
                ).fetchone()
            return None if row is None else self._run(row)
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError("Could not read Candidate Run.") from exc

    def list_decision_events(self, run_id: str) -> tuple[DecisionEventSummary, ...]:
        try:
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT * FROM decision_events WHERE run_id = ? ORDER BY ordinal",
                    (run_id,),
                ).fetchall()
            return tuple(self._event_summary(row) for row in rows)
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError("Could not list Decision Events.") from exc

    def get_decision_event(
        self, run_id: str, event_id: str
    ) -> DecisionEventDetail | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM decision_events WHERE run_id = ? AND id = ?",
                    (run_id, event_id),
                ).fetchone()
            return None if row is None else self._event_detail(row)
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError("Could not read Decision Event.") from exc

    def _transition(
        self,
        run_id: str,
        *,
        expected: BacktestRunStatus,
        status: BacktestRunStatus,
        assignments: str,
        values: tuple[object, ...],
    ) -> BacktestRunRecord:
        try:
            with self._connect() as connection:
                cursor = connection.execute(
                    f"""
                    UPDATE backtest_runs
                    SET status = ?, {assignments}
                    WHERE id = ? AND status = ?
                    """,
                    (status.value, *values, run_id, expected.value),
                )
                if cursor.rowcount != 1:
                    raise BacktestRunPersistenceError(
                        "Backtest Run lifecycle transition was rejected."
                    )
                row = connection.execute(
                    "SELECT * FROM backtest_runs WHERE id = ?", (run_id,)
                ).fetchone()
            if row is None:
                raise BacktestRunPersistenceError(
                    "Backtest Run disappeared during transition."
                )
            return self._run(row)
        except BacktestRunPersistenceError:
            raise
        except sqlite3.Error as exc:
            raise BacktestRunPersistenceError(
                "Could not update Backtest Run lifecycle."
            ) from exc

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @staticmethod
    def _run(row: sqlite3.Row) -> BacktestRunRecord:
        return BacktestRunRecord(
            id=row["id"],
            revision_id=row["revision_id"],
            candidate_id=row["candidate_id"],
            status=BacktestRunStatus(row["status"]),
            run_config=BacktestConfig.model_validate_json(row["config_json"]),
            result=(
                None
                if row["result_json"] is None
                else BacktestResult.model_validate_json(row["result_json"])
            ),
            error=(
                None
                if row["error_json"] is None
                else BacktestRunError.model_validate_json(row["error_json"])
            ),
            provenance=BacktestRunProvenance.model_validate_json(row["provenance_json"]),
            timings=BacktestTimings.model_validate_json(row["timings_json"]),
            created_at=_parse_timestamp(row["created_at"]),
            started_at=(
                None if row["started_at"] is None else _parse_timestamp(row["started_at"])
            ),
            completed_at=(
                None if row["completed_at"] is None else _parse_timestamp(row["completed_at"])
            ),
        )

    @staticmethod
    def _event_summary(row: sqlite3.Row) -> DecisionEventSummary:
        return DecisionEventSummary(
            id=row["id"],
            run_id=row["run_id"],
            ordinal=row["ordinal"],
            schema_version=row["schema_version"],
            session_id=row["session_id"],
            phase=row["phase"],
            kind=row["kind"],
            source_components=tuple(
                SourceComponentRef.model_validate(item)
                for item in json.loads(row["source_components_json"])
            ),
        )

    @classmethod
    def _event_detail(cls, row: sqlite3.Row) -> DecisionEventDetail:
        summary = cls._event_summary(row)
        return DecisionEventDetail.model_validate(
            {
                **summary.model_dump(mode="json"),
                "evidence": json.loads(row["evidence_json"]),
            }
        )


def _model_json(model: BaseModel) -> str:
    payload: dict[str, Any] = model.model_dump(mode="json")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)
