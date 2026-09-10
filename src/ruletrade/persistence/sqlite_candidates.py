from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from time import perf_counter_ns

from ruletrade.candidates.errors import CandidatePersistenceError
from ruletrade.candidates.models import (
    CandidateDiagnostics,
    CandidateRecord,
    FilterThresholdChange,
)
from ruletrade.diagnostics import elapsed_ms
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategy.v1.models import CanonicalStrategyV1


class SQLiteCandidateRepository:
    """Storage mechanics for immutable Candidate hypotheses."""

    def __init__(self, path: Path) -> None:
        self.path = path
        SQLiteStrategyRepository(path)

    def create(self, candidate: CandidateRecord) -> int:
        started = perf_counter_ns()
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO candidates (
                        id, base_revision_id, originating_run_id,
                        originating_decision_event_id, change_json, canonical_json,
                        source_hash, schema_version, created_at, diagnostics_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        candidate.id,
                        candidate.base_revision_id,
                        candidate.originating_run_id,
                        candidate.originating_decision_event_id,
                        _json(candidate.change.model_dump(mode="json")),
                        _json(candidate.canonical_strategy.model_dump(mode="json")),
                        candidate.source_hash,
                        candidate.schema_version,
                        candidate.created_at.isoformat().replace("+00:00", "Z"),
                        _json(candidate.diagnostics.model_dump(mode="json")),
                    ),
                )
            return elapsed_ms(started)
        except sqlite3.Error as exc:
            raise CandidatePersistenceError("Could not persist Candidate.") from exc

    def get(self, candidate_id: str) -> CandidateRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM candidates WHERE id = ?", (candidate_id,)
                ).fetchone()
            if row is None:
                return None
            return CandidateRecord(
                id=row["id"],
                base_revision_id=row["base_revision_id"],
                originating_run_id=row["originating_run_id"],
                originating_decision_event_id=row["originating_decision_event_id"],
                change=FilterThresholdChange.model_validate_json(row["change_json"]),
                canonical_strategy=CanonicalStrategyV1.model_validate_json(row["canonical_json"]),
                source_hash=row["source_hash"],
                schema_version=row["schema_version"],
                created_at=datetime.fromisoformat(row["created_at"]),
                diagnostics=CandidateDiagnostics.model_validate_json(
                    row["diagnostics_json"]
                ),
            )
        except sqlite3.Error as exc:
            raise CandidatePersistenceError("Could not read Candidate.") from exc

    def list_for_run(self, run_id: str) -> tuple[CandidateRecord, ...]:
        try:
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT id FROM candidates WHERE originating_run_id = ? "
                    "ORDER BY created_at DESC, id DESC",
                    (run_id,),
                ).fetchall()
            candidates = tuple(self.get(row["id"]) for row in rows)
            if any(candidate is None for candidate in candidates):
                raise CandidatePersistenceError("Candidate disappeared while listing.")
            return tuple(candidate for candidate in candidates if candidate is not None)
        except sqlite3.Error as exc:
            raise CandidatePersistenceError("Could not list Candidates.") from exc

    def update_diagnostics(
        self, candidate_id: str, diagnostics: CandidateDiagnostics
    ) -> None:
        try:
            with self._connect() as connection:
                cursor = connection.execute(
                    "UPDATE candidates SET diagnostics_json = ? WHERE id = ?",
                    (_json(diagnostics.model_dump(mode="json")), candidate_id),
                )
                if cursor.rowcount != 1:
                    raise CandidatePersistenceError("Candidate was not found.")
        except CandidatePersistenceError:
            raise
        except sqlite3.Error as exc:
            raise CandidatePersistenceError(
                "Could not persist Candidate diagnostics."
            ) from exc

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
