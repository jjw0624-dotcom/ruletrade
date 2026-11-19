from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from ruletrade.experiments.errors import ExperimentNotFoundError, ResearchExperimentError
from ruletrade.experiments.models import (
    ExperimentCandidateRecord,
    ResearchExperimentKind,
    ResearchExperimentRecord,
)
from ruletrade.strategy.versioning import parse_canonical_strategy


class SQLiteResearchExperimentRepository:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._initialize()

    def _initialize(self) -> None:
        try:
            with self._connect() as connection:
                connection.executescript("""
                CREATE TABLE IF NOT EXISTS research_experiments (
                    id TEXT PRIMARY KEY, revision_id TEXT NOT NULL, kind TEXT NOT NULL,
                    name TEXT NOT NULL, spec_json TEXT NOT NULL, created_at TEXT NOT NULL,
                    FOREIGN KEY (revision_id) REFERENCES strategy_revisions(id)
                );
                CREATE TABLE IF NOT EXISTS research_experiment_candidates (
                    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
                    parameters_json TEXT NOT NULL, canonical_json TEXT NOT NULL,
                    source_hash TEXT NOT NULL, run_id TEXT UNIQUE, created_at TEXT NOT NULL,
                    UNIQUE (experiment_id, ordinal),
                    FOREIGN KEY (experiment_id) REFERENCES research_experiments(id),
                    FOREIGN KEY (run_id) REFERENCES backtest_runs(id)
                );
                CREATE INDEX IF NOT EXISTS research_experiments_revision_created
                    ON research_experiments(revision_id, created_at DESC, id DESC);
                CREATE TRIGGER IF NOT EXISTS research_experiments_no_update
                BEFORE UPDATE ON research_experiments BEGIN
                    SELECT RAISE(ABORT, 'research experiments are immutable');
                END;
                CREATE TRIGGER IF NOT EXISTS research_experiments_no_delete
                BEFORE DELETE ON research_experiments BEGIN
                    SELECT RAISE(ABORT, 'research experiments are immutable');
                END;
                CREATE TRIGGER IF NOT EXISTS research_experiment_candidates_identity
                BEFORE UPDATE ON research_experiment_candidates
                WHEN NEW.id != OLD.id OR NEW.experiment_id != OLD.experiment_id
                    OR NEW.ordinal != OLD.ordinal OR NEW.parameters_json != OLD.parameters_json
                    OR NEW.canonical_json != OLD.canonical_json OR NEW.source_hash != OLD.source_hash
                    OR NEW.created_at != OLD.created_at OR OLD.run_id IS NOT NULL
                BEGIN
                    SELECT RAISE(ABORT, 'experiment candidate identity is immutable');
                END;
                CREATE TRIGGER IF NOT EXISTS research_experiment_candidates_no_delete
                BEFORE DELETE ON research_experiment_candidates BEGIN
                    SELECT RAISE(ABORT, 'experiment candidates are immutable');
                END;
                """)
        except sqlite3.Error as exc:
            raise ResearchExperimentError("Could not initialize Research Experiment persistence.") from exc

    def create(self, experiment: ResearchExperimentRecord) -> None:
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "INSERT INTO research_experiments VALUES (?, ?, ?, ?, ?, ?)",
                    (experiment.id, experiment.revision_id, experiment.kind.value, experiment.name,
                     json.dumps(experiment.spec, sort_keys=True, separators=(",", ":")), experiment.created_at.isoformat()),
                )
                for item in experiment.candidates:
                    connection.execute(
                        """INSERT INTO research_experiment_candidates
                        (id, experiment_id, ordinal, parameters_json, canonical_json, source_hash, run_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)""",
                        (item.id, item.experiment_id, item.ordinal,
                         json.dumps(item.parameters, sort_keys=True, separators=(",", ":")),
                         item.canonical_strategy.model_dump_json(), item.source_hash, item.created_at.isoformat()),
                    )
        except sqlite3.Error as exc:
            raise ResearchExperimentError("Could not persist Research Experiment.") from exc

    def add_candidate(self, candidate: ExperimentCandidateRecord) -> None:
        try:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO research_experiment_candidates
                    (id, experiment_id, ordinal, parameters_json, canonical_json, source_hash, run_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)""",
                    (
                        candidate.id, candidate.experiment_id, candidate.ordinal,
                        json.dumps(candidate.parameters, sort_keys=True, separators=(",", ":")),
                        candidate.canonical_strategy.model_dump_json(), candidate.source_hash,
                        candidate.created_at.isoformat(),
                    ),
                )
        except sqlite3.Error as exc:
            raise ResearchExperimentError("Could not append Research Experiment Candidate.") from exc

    def attach_run(self, candidate_id: str, run_id: str) -> None:
        try:
            with self._connect() as connection:
                changed = connection.execute(
                    "UPDATE research_experiment_candidates SET run_id = ? WHERE id = ? AND run_id IS NULL",
                    (run_id, candidate_id),
                ).rowcount
                if changed != 1:
                    raise ResearchExperimentError("Experiment Candidate Run linkage was rejected.")
        except sqlite3.Error as exc:
            raise ResearchExperimentError("Could not attach Experiment Candidate Run.") from exc

    def get(self, experiment_id: str) -> ResearchExperimentRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM research_experiments WHERE id = ?", (experiment_id,)).fetchone()
            if row is None:
                raise ExperimentNotFoundError("Research Experiment was not found.")
            candidates = connection.execute(
                "SELECT * FROM research_experiment_candidates WHERE experiment_id = ? ORDER BY ordinal",
                (experiment_id,),
            ).fetchall()
        return self._record(row, candidates)

    def list_for_revision(self, revision_id: str) -> tuple[ResearchExperimentRecord, ...]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id FROM research_experiments WHERE revision_id = ? ORDER BY created_at DESC, id DESC",
                (revision_id,),
            ).fetchall()
        return tuple(self.get(row["id"]) for row in rows)

    def list_for_revisions(self, revision_ids: tuple[str, ...]) -> tuple[ResearchExperimentRecord, ...]:
        if not revision_ids:
            return ()
        placeholders = ", ".join("?" for _ in revision_ids)
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT id FROM research_experiments WHERE revision_id IN ({placeholders}) "
                "ORDER BY created_at DESC, id DESC",
                revision_ids,
            ).fetchall()
        return tuple(self.get(row["id"]) for row in rows)

    def _record(self, row: sqlite3.Row, candidates: list[sqlite3.Row]) -> ResearchExperimentRecord:
        return ResearchExperimentRecord(
            id=row["id"], revision_id=row["revision_id"], kind=ResearchExperimentKind(row["kind"]),
            name=row["name"], spec=json.loads(row["spec_json"]), created_at=datetime.fromisoformat(row["created_at"]),
            candidates=tuple(ExperimentCandidateRecord(
                id=item["id"], experiment_id=item["experiment_id"], ordinal=item["ordinal"],
                parameters=json.loads(item["parameters_json"]),
                canonical_strategy=parse_canonical_strategy(json.loads(item["canonical_json"])),
                source_hash=item["source_hash"], run_id=item["run_id"], created_at=datetime.fromisoformat(item["created_at"]),
            ) for item in candidates),
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection
