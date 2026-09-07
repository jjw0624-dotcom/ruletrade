from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from ruletrade.core.intents import RebalanceIntent


class LeanAlgorithmPort(Protocol):
    """Minimal LEAN surface required by RuleTrade execution."""

    def set_holdings(
        self,
        symbol: str,
        percentage: float,
    ) -> object:
        ...

    def liquidate(
        self,
        symbol: str,
    ) -> object:
        ...


@dataclass(frozen=True)
class ExecutionReport:
    executed_targets: dict[str, Decimal]
    liquidated_symbols: tuple[str, ...]


def execute_rebalance(
    algorithm: LeanAlgorithmPort,
    intent: RebalanceIntent,
    *,
    currently_invested: set[str] | None = None,
) -> ExecutionReport:
    current = currently_invested or set()
    targets = dict(intent.target_weights)

    target_symbols = {
        symbol
        for symbol, weight in targets.items()
        if weight > 0
    }

    to_liquidate = sorted(current - target_symbols)

    for symbol in to_liquidate:
        algorithm.liquidate(symbol)

    for symbol in sorted(target_symbols):
        algorithm.set_holdings(
            symbol,
            float(targets[symbol]),
        )

    return ExecutionReport(
        executed_targets={
            symbol: targets[symbol]
            for symbol in sorted(target_symbols)
        },
        liquidated_symbols=tuple(to_liquidate),
    )
