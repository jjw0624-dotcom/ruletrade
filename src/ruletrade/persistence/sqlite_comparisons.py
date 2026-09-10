from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from time import perf_counter_ns

from ruletrade.comparisons.errors import ComparisonPersistenceError
from ruletrade.comparisons.models import ComparisonDiagnostics, ComparisonRecord
from ruletrade.diagnostics import elapsed_ms
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository


class SQLiteComparisonRepository:
    """Storage mechanics for immutable, reproducible Comparison payloads."""

    def __init__(self, path: Path) -> None:
        self.path = path
        SQLiteStrategyRepository(path)

    def create(self, comparison: ComparisonRecord) -> int:
        payload = json.dumps(
            comparison.model_dump(mode="json", exclude={"diagnostics"}),
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        started = perf_counter_ns()
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO comparisons (
                        id, candidate_id, original_run_id, candidate_run_id,
                        schema_version, comparison_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        comparison.id,
                        comparison.candidate_id,
                        comparison.original_run_id,
                        comparison.candidate_run_id,
                        comparison.schema_version,
                        payload,
                        comparison.created_at.isoformat().replace("+00:00", "Z"),
                    ),
                )
            return elapsed_ms(started)
        except sqlite3.IntegrityError as exc:
            raise ComparisonPersistenceError("Comparison already exists.") from exc
        except sqlite3.Error as exc:
            raise ComparisonPersistenceError("Could not persist Comparison.") from exc

    def get(self, comparison_id: str) -> ComparisonRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT comparison_json, diagnostics_json FROM comparisons WHERE id = ?",
                    (comparison_id,),
                ).fetchone()
            return (
                None
                if row is None
                else self._comparison(row)
            )
        except sqlite3.Error as exc:
            raise ComparisonPersistenceError("Could not read Comparison.") from exc

    def get_for_candidate(self, candidate_id: str) -> ComparisonRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT comparison_json, diagnostics_json FROM comparisons WHERE candidate_id = ?",
                    (candidate_id,),
                ).fetchone()
            return (
                None
                if row is None
                else self._comparison(row)
            )
        except sqlite3.Error as exc:
            raise ComparisonPersistenceError("Could not read Comparison.") from exc

    def update_diagnostics(
        self, comparison_id: str, diagnostics: ComparisonDiagnostics
    ) -> None:
        try:
            with self._connect() as connection:
                cursor = connection.execute(
                    "UPDATE comparisons SET diagnostics_json = ? WHERE id = ?",
                    (
                        json.dumps(
                            diagnostics.model_dump(mode="json"),
                            sort_keys=True,
                            separators=(",", ":"),
                        ),
                        comparison_id,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ComparisonPersistenceError("Comparison was not found.")
        except ComparisonPersistenceError:
            raise
        except sqlite3.Error as exc:
            raise ComparisonPersistenceError(
                "Could not persist Comparison diagnostics."
            ) from exc

    @staticmethod
    def _comparison(row: sqlite3.Row) -> ComparisonRecord:
        comparison = ComparisonRecord.model_validate_json(row["comparison_json"])
        return comparison.model_copy(
            update={
                "diagnostics": ComparisonDiagnostics.model_validate_json(
                    row["diagnostics_json"]
                )
            }
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection
