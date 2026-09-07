from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class GroupResolutionTrace:
    group_id: str
    universe: tuple[str, ...]
    selected_symbols: tuple[str, ...]
    local_weights: dict[str, Decimal]
    portfolio_weights: dict[str, Decimal]
