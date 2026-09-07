from __future__ import annotations

from datetime import datetime
from typing import Protocol

from ruletrade.adapters.lean.execution import (
    ExecutionReport,
    execute_rebalance,
)
from ruletrade.core.events import RebalanceEvent
from ruletrade.core.runtime import (
    EmptyContext,
    RuntimeResult,
    StrategyState,
    evaluate_strategy,
)
from ruletrade.strategy.models import StrategyDocument


class LeanRuntimeAlgorithmPort(Protocol):
    def set_holdings(
        self,
        symbol: object,
        percentage: float,
    ) -> object:
        ...

    def liquidate(
        self,
        symbol: object,
    ) -> object:
        ...


class LeanRuntimeBridge:
    """Connect engine-independent RuleTrade Core decisions to LEAN."""

    def __init__(
        self,
        strategy: StrategyDocument,
        symbols: dict[str, object],
    ) -> None:
        self.strategy = strategy
        self.symbols = dict(symbols)
        self.state = StrategyState(values={})

    def evaluate(
        self,
        *,
        algorithm: LeanRuntimeAlgorithmPort,
        occurred_at: datetime,
        event_id: str,
        currently_invested: set[str],
    ) -> tuple[RuntimeResult, tuple[ExecutionReport, ...]]:
        result = evaluate_strategy(
            self.strategy,
            event=RebalanceEvent(
                occurred_at=occurred_at,
                event_id=event_id,
            ),
            context=EmptyContext(),
            state=self.state,
        )

        self.state = result.state
        reports: list[ExecutionReport] = []

        for intent in result.intents:
            mapped_intent = type(intent)(
                target_weights={
                    self.symbols[ticker]: weight
                    for ticker, weight in intent.target_weights.items()
                }
            )

            mapped_current = {
                self.symbols[ticker]
                for ticker in currently_invested
                if ticker in self.symbols
            }

            reports.append(
                execute_rebalance(
                    algorithm,
                    mapped_intent,
                    currently_invested=mapped_current,
                )
            )

        return result, tuple(reports)
