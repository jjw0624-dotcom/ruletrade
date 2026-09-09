from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from ruletrade.hashing import strategy_hash
from ruletrade.persistence.sqlite_strategies import AppendStatus, SQLiteStrategyRepository
from ruletrade.strategies.errors import (
    InvalidStrategySourceError,
    PersistenceError,
    RevisionNotFoundError,
    SourceIssue,
    StaleRevisionError,
    StrategyArchivedError,
    StrategyNotFoundError,
)
from ruletrade.strategies.models import (
    RevisionRecord,
    RevisionSummary,
    SaveRevisionResponse,
    StrategyDetail,
    StrategyRecord,
)
from ruletrade.strategies.serialization import serialize_source_snapshot
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.validation import collect_semantic_issues


class StrategyService:
    """Own Strategy identity, immutable Revision, and concurrency semantics."""

    def __init__(
        self,
        repository: SQLiteStrategyRepository,
        *,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid4()))

    def list_strategies(self) -> tuple[StrategyRecord, ...]:
        return self.repository.list_strategies()

    def create_strategy(
        self,
        name: str,
        source: CanonicalStrategyV1 | Mapping[str, Any],
    ) -> StrategyDetail:
        canonical = self._validate_source(source)
        timestamp = self._clock()
        strategy_id = self._id_factory()
        revision_id = self._id_factory()
        strategy = StrategyRecord(
            id=strategy_id,
            name=name,
            created_at=timestamp,
            updated_at=timestamp,
            current_revision_id=revision_id,
        )
        revision = RevisionRecord(
            id=revision_id,
            strategy_id=strategy_id,
            parent_revision_id=None,
            canonical_strategy=canonical,
            source_hash=strategy_hash(canonical),
            schema_version=canonical.api_version,
            created_at=timestamp,
        )
        self.repository.create_strategy(
            strategy,
            revision,
            serialize_source_snapshot(canonical),
        )
        return StrategyDetail(strategy=strategy, current_revision=revision)

    def get_strategy(self, strategy_id: str) -> StrategyDetail:
        strategy = self._require_strategy(strategy_id)
        revision = self.repository.get_revision(strategy_id, strategy.current_revision_id)
        if revision is None:
            raise PersistenceError("Strategy current Revision is missing.")
        return StrategyDetail(strategy=strategy, current_revision=revision)

    def rename_strategy(self, strategy_id: str, name: str) -> StrategyDetail:
        strategy = self._require_strategy(strategy_id)
        if strategy.archived_at is not None:
            raise StrategyArchivedError("Archived Strategies cannot be renamed.")
        updated = self.repository.rename_strategy(strategy_id, name, self._clock())
        if updated is None:
            raise StrategyArchivedError("Archived Strategies cannot be renamed.")
        revision = self.repository.get_revision(strategy_id, updated.current_revision_id)
        if revision is None:
            raise PersistenceError("Strategy current Revision is missing.")
        return StrategyDetail(strategy=updated, current_revision=revision)

    def archive_strategy(self, strategy_id: str) -> StrategyRecord:
        strategy = self._require_strategy(strategy_id)
        if strategy.archived_at is not None:
            return strategy
        archived = self.repository.archive_strategy(strategy_id, self._clock())
        if archived is None:
            return self._require_strategy(strategy_id)
        return archived

    def list_revisions(self, strategy_id: str) -> tuple[RevisionSummary, ...]:
        self._require_strategy(strategy_id)
        return self.repository.list_revisions(strategy_id)

    def get_revision(self, strategy_id: str, revision_id: str) -> RevisionRecord:
        self._require_strategy(strategy_id)
        revision = self.repository.get_revision(strategy_id, revision_id)
        if revision is None:
            raise RevisionNotFoundError("Strategy Revision was not found.")
        return revision

    def get_revision_by_id(self, revision_id: str) -> RevisionRecord:
        revision = self.repository.get_revision_by_id(revision_id)
        if revision is None:
            raise RevisionNotFoundError("Strategy Revision was not found.")
        return revision

    def save_revision(
        self,
        strategy_id: str,
        expected_parent_revision_id: str,
        source: CanonicalStrategyV1 | Mapping[str, Any],
    ) -> SaveRevisionResponse:
        canonical = self._validate_source(source)
        timestamp = self._clock()
        revision = RevisionRecord(
            id=self._id_factory(),
            strategy_id=strategy_id,
            parent_revision_id=expected_parent_revision_id,
            canonical_strategy=canonical,
            source_hash=strategy_hash(canonical),
            schema_version=canonical.api_version,
            created_at=timestamp,
        )
        result = self.repository.append_revision(
            strategy_id,
            expected_parent_revision_id,
            revision,
            serialize_source_snapshot(canonical),
        )
        if result.status == AppendStatus.NOT_FOUND:
            raise StrategyNotFoundError("Strategy was not found.")
        if result.status == AppendStatus.ARCHIVED:
            raise StrategyArchivedError("Archived Strategies cannot accept new Revisions.")
        if result.status == AppendStatus.STALE:
            assert result.strategy is not None
            raise StaleRevisionError(result.strategy.current_revision_id)
        assert result.strategy is not None and result.revision is not None
        return SaveRevisionResponse(
            created=result.status == AppendStatus.CREATED,
            strategy=result.strategy,
            revision=result.revision,
        )

    def _require_strategy(self, strategy_id: str) -> StrategyRecord:
        strategy = self.repository.get_strategy(strategy_id)
        if strategy is None:
            raise StrategyNotFoundError("Strategy was not found.")
        return strategy

    @staticmethod
    def _validate_source(
        source: CanonicalStrategyV1 | Mapping[str, Any],
    ) -> CanonicalStrategyV1:
        try:
            canonical = (
                source
                if isinstance(source, CanonicalStrategyV1)
                else CanonicalStrategyV1.model_validate(source)
            )
        except ValidationError as exc:
            issues = tuple(
                SourceIssue(
                    path=".".join(str(item) for item in error["loc"]),
                    message=error["msg"],
                )
                for error in exc.errors(include_url=False)
            )
            raise InvalidStrategySourceError(issues) from exc

        semantic_issues = collect_semantic_issues(canonical)
        if semantic_issues:
            raise InvalidStrategySourceError(
                tuple(SourceIssue(issue.path, issue.message) for issue in semantic_issues)
            )
        return canonical
