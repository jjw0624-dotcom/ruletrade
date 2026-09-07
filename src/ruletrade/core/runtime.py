from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ruletrade.core.events import RebalanceEvent
from ruletrade.core.intents import RebalanceIntent
from ruletrade.core.portfolio import resolve_portfolio
from ruletrade.core.trace import GroupResolutionTrace
from ruletrade.strategy.models import StrategyDocument


class StrategyContext(Protocol):
    """Engine-independent market and portfolio context.

    V0 does not require any context values yet. Future strategy
    primitives will request prices, indicators, holdings, cash,
    average cost, and other engine-provided values through this
    interface rather than importing LEAN-specific APIs.
    """


@dataclass(frozen=True)
class StrategyState:
    values: dict[str, object]


@dataclass(frozen=True)
class RuntimeResult:
    intents: tuple[RebalanceIntent, ...]
    trace: tuple[GroupResolutionTrace, ...]
    state: StrategyState


class EmptyContext:
    pass


def evaluate_strategy(
    strategy: StrategyDocument,
    *,
    event: RebalanceEvent,
    context: StrategyContext,
    state: StrategyState,
) -> RuntimeResult:
    resolution = resolve_portfolio(strategy)
    del context

    resolution = resolve_portfolio(
    strategy,
    event_id=event.event_id,
)

    intent = RebalanceIntent(
        target_weights=dict(resolution.target_weights)
    )

    trace = tuple(
        GroupResolutionTrace(
            group_id=group.group_id,
            universe=tuple(
                next(
                    strategy_group.universe
                    for strategy_group in strategy.groups
                    if strategy_group.id == group.group_id
                )
            ),
            selected_symbols=group.selected_symbols,
            local_weights=dict(group.local_weights),
            portfolio_weights=dict(group.portfolio_weights),
        )
        for group in resolution.groups
    )

    return RuntimeResult(
        intents=(intent,),
        trace=trace,
        state=state,
    )
