from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path

from ruletrade.strategies.errors import PersistenceError
from ruletrade.strategies.models import RevisionRecord, RevisionSummary, StrategyRecord
from ruletrade.strategy.v1.models import CanonicalStrategyV1

SCHEMA_VERSION = 1


class AppendStatus(str, Enum):
    CREATED = "created"
    IDENTICAL = "identical"
    STALE = "stale"
    NOT_FOUND = "not_found"
    ARCHIVED = "archived"


@dataclass(frozen=True)
class AppendResult:
    status: AppendStatus
    strategy: StrategyRecord | None = None
    revision: RevisionRecord | None = None


class SQLiteStrategyRepository:
    """SQLite mechanics for the Strategy/Revision aggregate; domain policy lives in the service."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.initialize()

    def initialize(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self._connect() as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                if version not in {0, SCHEMA_VERSION}:
                    raise PersistenceError(
                        f"unsupported Strategy database schema version: {version}"
                    )
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS strategies (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        current_revision_id TEXT NOT NULL,
                        archived_at TEXT,
                        FOREIGN KEY (current_revision_id)
                            REFERENCES strategy_revisions(id)
                            DEFERRABLE INITIALLY DEFERRED
                    );

                    CREATE TABLE IF NOT EXISTS strategy_revisions (
                        id TEXT PRIMARY KEY,
                        strategy_id TEXT NOT NULL,
                        parent_revision_id TEXT,
                        canonical_json TEXT NOT NULL,
                        source_hash TEXT NOT NULL,
                        schema_version TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (strategy_id) REFERENCES strategies(id),
                        FOREIGN KEY (parent_revision_id) REFERENCES strategy_revisions(id)
                    );

                    CREATE INDEX IF NOT EXISTS strategy_revisions_strategy_created
                        ON strategy_revisions(strategy_id, created_at DESC, id DESC);

                    CREATE TRIGGER IF NOT EXISTS strategy_revisions_no_update
                    BEFORE UPDATE ON strategy_revisions
                    BEGIN
                        SELECT RAISE(ABORT, 'strategy revisions are immutable');
                    END;

                    CREATE TRIGGER IF NOT EXISTS strategy_revisions_no_delete
                    BEFORE DELETE ON strategy_revisions
                    BEGIN
                        SELECT RAISE(ABORT, 'strategy revisions are immutable');
                    END;
                    """
                )
                if version == 0:
                    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        except PersistenceError:
            raise
        except sqlite3.Error as exc:
            raise PersistenceError("Could not initialize Strategy persistence.") from exc

    def list_strategies(self) -> tuple[StrategyRecord, ...]:
        try:
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM strategies
                    WHERE archived_at IS NULL
                    ORDER BY updated_at DESC, id ASC
                    """
                ).fetchall()
            return tuple(self._strategy(row) for row in rows)
        except sqlite3.Error as exc:
            raise PersistenceError("Could not list Strategies.") from exc

    def get_strategy(self, strategy_id: str) -> StrategyRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM strategies WHERE id = ?",
                    (strategy_id,),
                ).fetchone()
            return None if row is None else self._strategy(row)
        except sqlite3.Error as exc:
            raise PersistenceError("Could not read Strategy.") from exc

    def get_revision(
        self,
        strategy_id: str,
        revision_id: str,
    ) -> RevisionRecord | None:
        try:
            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT * FROM strategy_revisions
                    WHERE strategy_id = ? AND id = ?
                    """,
                    (strategy_id, revision_id),
                ).fetchone()
            return None if row is None else self._revision(row)
        except sqlite3.Error as exc:
            raise PersistenceError("Could not read Strategy Revision.") from exc

    def list_revisions(self, strategy_id: str) -> tuple[RevisionSummary, ...]:
        try:
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT id, strategy_id, parent_revision_id, source_hash,
                           schema_version, created_at
                    FROM strategy_revisions
                    WHERE strategy_id = ?
                    ORDER BY created_at DESC, id DESC
                    """,
                    (strategy_id,),
                ).fetchall()
            return tuple(self._revision_summary(row) for row in rows)
        except sqlite3.Error as exc:
            raise PersistenceError("Could not list Strategy Revisions.") from exc

    def create_strategy(
        self,
        strategy: StrategyRecord,
        revision: RevisionRecord,
        canonical_json: str,
    ) -> None:
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                    INSERT INTO strategies (
                        id, name, created_at, updated_at, current_revision_id, archived_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        strategy.id,
                        strategy.name,
                        _timestamp(strategy.created_at),
                        _timestamp(strategy.updated_at),
                        strategy.current_revision_id,
                        None,
                    ),
                )
                self._insert_revision(connection, revision, canonical_json)
                connection.commit()
        except sqlite3.Error as exc:
            raise PersistenceError("Could not create Strategy.") from exc

    def append_revision(
        self,
        strategy_id: str,
        expected_parent_revision_id: str,
        revision: RevisionRecord,
        canonical_json: str,
    ) -> AppendResult:
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                strategy_row = connection.execute(
                    "SELECT * FROM strategies WHERE id = ?",
                    (strategy_id,),
                ).fetchone()
                if strategy_row is None:
                    connection.rollback()
                    return AppendResult(AppendStatus.NOT_FOUND)
                strategy = self._strategy(strategy_row)
                current_row = connection.execute(
                    "SELECT * FROM strategy_revisions WHERE id = ?",
                    (strategy.current_revision_id,),
                ).fetchone()
                if current_row is None:
                    raise PersistenceError("Strategy current Revision is missing.")
                current = self._revision(current_row)
                if strategy.archived_at is not None:
                    connection.rollback()
                    return AppendResult(AppendStatus.ARCHIVED, strategy, current)
                if strategy.current_revision_id != expected_parent_revision_id:
                    connection.rollback()
                    return AppendResult(AppendStatus.STALE, strategy, current)
                if current_row["canonical_json"] == canonical_json:
                    connection.rollback()
                    return AppendResult(AppendStatus.IDENTICAL, strategy, current)

                self._insert_revision(connection, revision, canonical_json)
                connection.execute(
                    """
                    UPDATE strategies
                    SET current_revision_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (revision.id, _timestamp(revision.created_at), strategy_id),
                )
                connection.commit()
                updated = StrategyRecord(
                    **{
                        **strategy.model_dump(),
                        "current_revision_id": revision.id,
                        "updated_at": revision.created_at,
                    }
                )
                return AppendResult(AppendStatus.CREATED, updated, revision)
        except PersistenceError:
            raise
        except sqlite3.Error as exc:
            raise PersistenceError("Could not save Strategy Revision.") from exc

    def rename_strategy(
        self,
        strategy_id: str,
        name: str,
        updated_at: datetime,
    ) -> StrategyRecord | None:
        try:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE strategies
                    SET name = ?, updated_at = ?
                    WHERE id = ? AND archived_at IS NULL
                    """,
                    (name, _timestamp(updated_at), strategy_id),
                )
                if cursor.rowcount == 0:
                    return None
                row = connection.execute(
                    "SELECT * FROM strategies WHERE id = ?",
                    (strategy_id,),
                ).fetchone()
            return self._strategy(row)
        except sqlite3.Error as exc:
            raise PersistenceError("Could not rename Strategy.") from exc

    def archive_strategy(
        self,
        strategy_id: str,
        archived_at: datetime,
    ) -> StrategyRecord | None:
        try:
            timestamp = _timestamp(archived_at)
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE strategies
                    SET archived_at = ?, updated_at = ?
                    WHERE id = ? AND archived_at IS NULL
                    """,
                    (timestamp, timestamp, strategy_id),
                )
                if cursor.rowcount == 0:
                    return None
                row = connection.execute(
                    "SELECT * FROM strategies WHERE id = ?",
                    (strategy_id,),
                ).fetchone()
            return self._strategy(row)
        except sqlite3.Error as exc:
            raise PersistenceError("Could not archive Strategy.") from exc

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @staticmethod
    def _insert_revision(
        connection: sqlite3.Connection,
        revision: RevisionRecord,
        canonical_json: str,
    ) -> None:
        connection.execute(
            """
            INSERT INTO strategy_revisions (
                id, strategy_id, parent_revision_id, canonical_json,
                source_hash, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                revision.id,
                revision.strategy_id,
                revision.parent_revision_id,
                canonical_json,
                revision.source_hash,
                revision.schema_version,
                _timestamp(revision.created_at),
            ),
        )

    @staticmethod
    def _strategy(row: sqlite3.Row) -> StrategyRecord:
        return StrategyRecord(
            id=row["id"],
            name=row["name"],
            created_at=_parse_timestamp(row["created_at"]),
            updated_at=_parse_timestamp(row["updated_at"]),
            current_revision_id=row["current_revision_id"],
            archived_at=(
                None if row["archived_at"] is None else _parse_timestamp(row["archived_at"])
            ),
        )

    @staticmethod
    def _revision(row: sqlite3.Row) -> RevisionRecord:
        return RevisionRecord(
            id=row["id"],
            strategy_id=row["strategy_id"],
            parent_revision_id=row["parent_revision_id"],
            canonical_strategy=CanonicalStrategyV1.model_validate_json(row["canonical_json"]),
            source_hash=row["source_hash"],
            schema_version=row["schema_version"],
            created_at=_parse_timestamp(row["created_at"]),
        )

    @staticmethod
    def _revision_summary(row: sqlite3.Row) -> RevisionSummary:
        return RevisionSummary(
            id=row["id"],
            strategy_id=row["strategy_id"],
            parent_revision_id=row["parent_revision_id"],
            source_hash=row["source_hash"],
            schema_version=row["schema_version"],
            created_at=_parse_timestamp(row["created_at"]),
        )


def _timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)
