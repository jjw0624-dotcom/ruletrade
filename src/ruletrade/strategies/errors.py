from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceIssue:
    path: str
    message: str


class StrategyDomainError(Exception):
    code = "strategy_error"


class InvalidStrategySourceError(StrategyDomainError):
    code = "invalid_strategy_source"

    def __init__(self, issues: tuple[SourceIssue, ...]) -> None:
        super().__init__("Strategy source failed validation.")
        self.issues = issues


class StrategyNotFoundError(StrategyDomainError):
    code = "strategy_not_found"


class RevisionNotFoundError(StrategyDomainError):
    code = "revision_not_found"


class StrategyArchivedError(StrategyDomainError):
    code = "strategy_archived"


class StaleRevisionError(StrategyDomainError):
    code = "stale_revision"

    def __init__(self, current_revision_id: str) -> None:
        super().__init__("Strategy has advanced since this working copy was opened.")
        self.current_revision_id = current_revision_id


class PersistenceError(StrategyDomainError):
    code = "persistence_failure"
