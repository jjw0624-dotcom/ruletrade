from __future__ import annotations

import random

from ruletrade.strategy.models import (
    AllSelection,
    RandomNSelection,
    SelectionSpec,
)


def select_symbols(
    universe: list[str],
    selection: SelectionSpec,
    *,
    seed: int,
) -> list[str]:
    if isinstance(selection, AllSelection):
        return list(universe)

    if isinstance(selection, RandomNSelection):
        rng = random.Random(seed)

        selected = rng.sample(
            universe,
            selection.count,
        )

        # Canonical output order should not depend on random.sample's
        # returned order.
        return sorted(selected)

    raise TypeError(
        f"unsupported selection type: {type(selection).__name__}"
    )
