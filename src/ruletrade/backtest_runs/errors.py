from __future__ import annotations

from dataclasses import dataclass


class BacktestRunDomainError(Exception):
    code = "backtest_run_error"


class BacktestRunNotFoundError(BacktestRunDomainError):
    code = "run_not_found"


class BacktestRunPersistenceError(BacktestRunDomainError):
    code = "persistence_failure"


@dataclass(frozen=True)
class RunConfigIssue:
    path: str
    message: str


class InvalidRunConfigError(BacktestRunDomainError):
    code = "invalid_run_config"

    def __init__(self, issues: tuple[RunConfigIssue, ...]) -> None:
        super().__init__("Backtest Run configuration is invalid.")
        self.issues = issues
