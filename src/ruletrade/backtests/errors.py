from __future__ import annotations

from dataclasses import dataclass


class BacktestError(Exception):
    code = "backtest_error"


@dataclass(frozen=True)
class ValidationIssueData:
    path: str
    message: str


class InvalidStrategyError(BacktestError):
    code = "invalid_strategy"

    def __init__(self, issues: tuple[ValidationIssueData, ...]) -> None:
        super().__init__("Strategy failed semantic validation.")
        self.issues = issues


class UnsupportedStrategyError(BacktestError):
    code = "unsupported_strategy"


class LeanRuntimeUnavailableError(BacktestError):
    code = "runtime_unavailable"


class LeanExecutionError(BacktestError):
    code = "execution_failed"

    def __init__(self, message: str, *, diagnostic_output: str | None = None) -> None:
        super().__init__(message)
        self.diagnostic_output = diagnostic_output


class MalformedLeanResultError(BacktestError):
    code = "malformed_result"
