from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from ruletrade.challenges.errors import (
    ChallengeSubmissionNotFoundError,
    ChallengeSubmissionPersistenceError,
)
from ruletrade.challenges.models import ChallengeObjective, ChallengeSubmissionRecord


class SQLiteChallengeSubmissionRepository:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._initialize()

    def _initialize(self) -> None:
        try:
            with self._connect() as connection:
                connection.executescript("""
                CREATE TABLE IF NOT EXISTS challenge_submissions (
                    id TEXT PRIMARY KEY,
                    challenge_id TEXT NOT NULL,
                    challenge_version INTEGER NOT NULL,
                    policy_version INTEGER NOT NULL,
                    revision_id TEXT NOT NULL,
                    run_id TEXT NOT NULL UNIQUE,
                    catalog_id TEXT,
                    catalog_parameters_json TEXT NOT NULL,
                    eligible INTEGER NOT NULL,
                    violations_json TEXT NOT NULL,
                    score TEXT,
                    objective_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (revision_id) REFERENCES strategy_revisions(id),
                    FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
                );
                CREATE INDEX IF NOT EXISTS challenge_submissions_challenge_score
                    ON challenge_submissions(challenge_id, eligible, created_at, id);
                CREATE INDEX IF NOT EXISTS challenge_submissions_revision_created
                    ON challenge_submissions(revision_id, created_at DESC, id DESC);
                CREATE TRIGGER IF NOT EXISTS challenge_submissions_no_update
                BEFORE UPDATE ON challenge_submissions BEGIN
                    SELECT RAISE(ABORT, 'challenge submissions are immutable');
                END;
                CREATE TRIGGER IF NOT EXISTS challenge_submissions_no_delete
                BEFORE DELETE ON challenge_submissions BEGIN
                    SELECT RAISE(ABORT, 'challenge submissions are immutable');
                END;
                """ )
        except sqlite3.Error as exc:
            raise ChallengeSubmissionPersistenceError(
                "Could not initialize Challenge Submission persistence."
            ) from exc

    def create(self, submission: ChallengeSubmissionRecord) -> ChallengeSubmissionRecord:
        try:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO challenge_submissions
                    (id, challenge_id, challenge_version, policy_version, revision_id, run_id,
                     catalog_id, catalog_parameters_json, eligible, violations_json, score,
                     objective_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        submission.id, submission.challenge_id, submission.challenge_version,
                        submission.policy_version, submission.revision_id, submission.run_id,
                        submission.catalog_id,
                        json.dumps(submission.catalog_parameters, sort_keys=True, separators=(",", ":")),
                        int(submission.eligible),
                        json.dumps(submission.violations, separators=(",", ":")),
                        str(submission.score) if submission.score is not None else None,
                        submission.objective.model_dump_json(),
                        submission.created_at.isoformat(),
                    ),
                )
        except sqlite3.Error as exc:
            raise ChallengeSubmissionPersistenceError(
                "Could not persist Challenge Submission."
            ) from exc
        return submission

    def get(self, submission_id: str) -> ChallengeSubmissionRecord:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM challenge_submissions WHERE id = ?", (submission_id,)
            ).fetchone()
        if row is None:
            raise ChallengeSubmissionNotFoundError("Challenge Submission was not found.")
        return self._record(row)

    def list_for_challenge(self, challenge_id: str) -> tuple[ChallengeSubmissionRecord, ...]:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT * FROM challenge_submissions WHERE challenge_id = ?
                ORDER BY eligible DESC,
                    CASE WHEN score IS NULL THEN 1 ELSE 0 END,
                    CAST(score AS REAL) DESC,
                    created_at ASC, id ASC""",
                (challenge_id,),
            ).fetchall()
        return tuple(self._record(row) for row in rows)

    @staticmethod
    def _record(row: sqlite3.Row) -> ChallengeSubmissionRecord:
        return ChallengeSubmissionRecord(
            id=row["id"], challenge_id=row["challenge_id"],
            challenge_version=row["challenge_version"], policy_version=row["policy_version"],
            revision_id=row["revision_id"], run_id=row["run_id"], catalog_id=row["catalog_id"],
            catalog_parameters=json.loads(row["catalog_parameters_json"]),
            eligible=bool(row["eligible"]), violations=tuple(json.loads(row["violations_json"])),
            score=Decimal(row["score"]) if row["score"] is not None else None,
            objective=ChallengeObjective.model_validate_json(row["objective_json"]),
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection
