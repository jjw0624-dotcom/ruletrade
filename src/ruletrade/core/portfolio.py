from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal

from ruletrade.core.allocation import allocate_selected
from ruletrade.core.selection import select_symbols
from ruletrade.strategy.models import StrategyDocument


@dataclass(frozen=True)
class GroupResolution:
    group_id: str
    selected_symbols: tuple[str, ...]
    local_weights: dict[str, Decimal]
    portfolio_weights: dict[str, Decimal]


@dataclass(frozen=True)
class PortfolioResolution:
    target_weights: dict[str, Decimal]
    groups: tuple[GroupResolution, ...]


def _group_seed(
    strategy_seed: int,
    group_id: str,
) -> int:
    payload = f"{strategy_seed}:{group_id}".encode("utf-8")

    digest = hashlib.sha256(payload).digest()

    return int.from_bytes(
        digest[:8],
        byteorder="big",
        signed=False,
    )


def resolve_portfolio(
    strategy: StrategyDocument,
) -> PortfolioResolution:
    target_weights: dict[str, Decimal] = {}
    group_results: list[GroupResolution] = []

    for group in strategy.groups:
        seed = _group_seed(
            strategy.random_seed,
            group.id,
        )

        selected = select_symbols(
            group.universe,
            group.selection,
            seed=seed,
        )

        local_weights = allocate_selected(
            selected,
            group.allocation,
        )

        portfolio_weights = {
            symbol: group.weight * local_weight
            for symbol, local_weight in local_weights.items()
        }

        for symbol, weight in portfolio_weights.items():
            target_weights[symbol] = (
                target_weights.get(symbol, Decimal("0"))
                + weight
            )

        group_results.append(
            GroupResolution(
                group_id=group.id,
                selected_symbols=tuple(selected),
                local_weights=local_weights,
                portfolio_weights=portfolio_weights,
            )
        )

    total = sum(
        target_weights.values(),
        Decimal("0"),
    )

    if abs(total - Decimal("1")) > Decimal("0.00000001"):
        raise ValueError(
            f"resolved portfolio weights must sum to 1; got {total}"
        )

    return PortfolioResolution(
        target_weights=target_weights,
        groups=tuple(group_results),
    )
