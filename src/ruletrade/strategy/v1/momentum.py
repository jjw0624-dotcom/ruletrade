from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping, Sequence


@dataclass(frozen=True)
class MomentumSelectionResult:
    scores: tuple[tuple[str, Decimal], ...]
    ranked: tuple[str, ...]
    selected: tuple[str, ...]
    targets: tuple[tuple[str, Decimal], ...]


def evaluate_trailing_return_top_n(
    closes: Mapping[str, Sequence[Decimal]],
    *,
    lookback_bars: int,
    count: int,
    total_weight: Decimal = Decimal(1),
) -> MomentumSelectionResult:
    """Reference semantics over completed, adjusted daily closing observations.

    A lookback of L uses the latest close and the close L completed bars earlier,
    so an asset needs exactly L+1 comparable observations to be eligible.
    """

    if lookback_bars < 1 or count < 1:
        raise ValueError("lookback_bars and count must be positive")
    scores: dict[str, Decimal] = {}
    for symbol, observations in closes.items():
        if len(observations) < lookback_bars + 1:
            continue
        prior = Decimal(observations[-(lookback_bars + 1)])
        latest = Decimal(observations[-1])
        if prior <= 0 or latest <= 0:
            continue
        scores[symbol] = latest / prior - Decimal(1)
    ranked = tuple(sorted(scores, key=lambda symbol: (-scores[symbol], symbol)))
    selected = ranked[:count]
    if len(selected) < count:
        return MomentumSelectionResult(
            scores=tuple(sorted(scores.items())),
            ranked=ranked,
            selected=(),
            targets=(),
        )
    weight = total_weight / Decimal(count)
    return MomentumSelectionResult(
        scores=tuple(sorted(scores.items())),
        ranked=ranked,
        selected=selected,
        targets=tuple(sorted((symbol, weight) for symbol in selected)),
    )
