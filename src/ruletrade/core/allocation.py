from __future__ import annotations

from decimal import Decimal

from ruletrade.strategy.models import (
    AllocationSpec,
    EqualWeightAllocation,
    FixedWeightAllocation,
)


def allocate_selected(
    selected_symbols: list[str],
    allocation: AllocationSpec,
) -> dict[str, Decimal]:
    if not selected_symbols:
        return {}

    if isinstance(allocation, EqualWeightAllocation):
        weight = Decimal("1") / Decimal(len(selected_symbols))

        return {
            symbol: weight
            for symbol in selected_symbols
        }

    if isinstance(allocation, FixedWeightAllocation):
        configured = {
            item.symbol: item.weight
            for item in allocation.weights
        }

        selected_set = set(selected_symbols)

        if selected_set != set(configured):
            raise ValueError(
                "fixed_weight allocation requires all configured symbols "
                "to be selected"
            )

        return {
            symbol: configured[symbol]
            for symbol in selected_symbols
        }

    raise TypeError(
        f"unsupported allocation type: {type(allocation).__name__}"
    )
