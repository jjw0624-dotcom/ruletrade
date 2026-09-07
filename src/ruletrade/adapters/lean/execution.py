from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Hashable, Protocol

from ruletrade.core.intents import RebalanceIntent


LeanSymbol = Hashable


class LeanAlgorithmPort(Protocol):
    """Minimal LEAN surface required by RuleTrade execution."""

    def set_holdings(
        self,
        symbol: LeanSymbol,
        percentage: float,
    ) -> object:
        ...

    def liquidate(
        self,
        symbol: LeanSymbol,
    ) -> object:
        ...


@dataclass(frozen=True)
class ExecutionReport:
    executed_targets: dict[LeanSymbol, Decimal]
    liquidated_symbols: tuple[LeanSymbol, ...]


def execute_rebalance(
    algorithm: LeanAlgorithmPort,
    intent: RebalanceIntent,
    *,
    currently_invested: set[LeanSymbol] | None = None,
) -> ExecutionReport:
    current = currently_invested or set()

    targets = {
        symbol: weight
        for symbol, weight in intent.target_weights.items()
        if weight > 0
    }

    target_symbols = set(targets)

    # Do not assume engine-specific symbol objects are orderable.
    # Liquidation order is irrelevant to RuleTrade semantics.
    to_liquidate = tuple(
        symbol
        for symbol in current
        if symbol not in target_symbols
    )

    for symbol in to_liquidate:
        algorithm.liquidate(symbol)

    # Preserve the canonical intent dictionary order instead of sorting
    # engine-specific symbol objects.
    for symbol, weight in targets.items():
        algorithm.set_holdings(
            symbol,
            float(weight),
        )

    return ExecutionReport(
        executed_targets=dict(targets),
        liquidated_symbols=to_liquidate,
    )
