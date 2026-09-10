"""Application services for executing RuleTrade strategies."""

from typing import TYPE_CHECKING

from ruletrade.backtests.models import (
    BacktestConfig,
    BacktestResult,
    EquityPoint,
    LeanBacktestRequest,
    LeanBacktestResponse,
)

if TYPE_CHECKING:
    from ruletrade.backtests.service import BacktestService

__all__ = [
    "BacktestConfig",
    "BacktestResult",
    "BacktestService",
    "EquityPoint",
    "LeanBacktestRequest",
    "LeanBacktestResponse",
]


def __getattr__(name: str) -> object:
    """Preserve the service re-export without importing it during model loading."""

    if name == "BacktestService":
        from ruletrade.backtests.service import BacktestService

        return BacktestService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
