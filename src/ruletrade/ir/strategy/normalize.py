from __future__ import annotations

from dataclasses import replace

from ruletrade.ir.strategy.model import StrategyIR


def normalize_strategy_ir(strategy_ir: StrategyIR) -> StrategyIR:
    """Return a stable ordering without rewriting financial semantics."""

    return replace(
        strategy_ir,
        operations=tuple(sorted(strategy_ir.operations, key=lambda operation: operation.id)),
        entrypoints=tuple(
            sorted(strategy_ir.entrypoints, key=lambda entrypoint: (entrypoint.event, entrypoint.target))
        ),
    )
