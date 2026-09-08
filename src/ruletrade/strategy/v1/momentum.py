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


@dataclass(frozen=True)
class FilteredMomentumSelectionResult:
    scores: tuple[tuple[str, Decimal], ...]
    eligible: tuple[str, ...]
    rejected: tuple[str, ...]
    ranked: tuple[str, ...]
    selected: tuple[str, ...]
    targets: tuple[tuple[str, Decimal], ...]


def _trailing_return_scores(
    closes: Mapping[str, Sequence[Decimal]], lookback_bars: int
) -> dict[str, Decimal]:
    scores: dict[str, Decimal] = {}
    for symbol, observations in closes.items():
        if len(observations) < lookback_bars + 1:
            continue
        prior = Decimal(observations[-(lookback_bars + 1)])
        latest = Decimal(observations[-1])
        if prior <= 0 or latest <= 0:
            continue
        scores[symbol] = latest / prior - Decimal(1)
    return scores


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
    scores = _trailing_return_scores(closes, lookback_bars)
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


def evaluate_filtered_trailing_return_top_n(
    closes: Mapping[str, Sequence[Decimal]],
    *,
    lookback_bars: int,
    threshold: Decimal,
    count: int,
    total_weight: Decimal = Decimal(1),
) -> FilteredMomentumSelectionResult:
    """Apply strict score > threshold screening before deterministic Top N.

    Missing or incomplete scores are ineligible. If fewer than ``count`` assets
    pass, selection and targets are empty so a runtime keeps existing holdings.
    """

    if lookback_bars < 1 or count < 1:
        raise ValueError("lookback_bars and count must be positive")
    threshold = Decimal(threshold)
    scores = _trailing_return_scores(closes, lookback_bars)
    eligible_scores = {
        symbol: score for symbol, score in scores.items() if score > threshold
    }
    eligible = tuple(sorted(eligible_scores))
    rejected = tuple(sorted(set(scores) - set(eligible_scores)))
    ranked = tuple(sorted(eligible_scores, key=lambda symbol: (-eligible_scores[symbol], symbol)))
    selected = ranked[:count]
    if len(selected) < count:
        selected = ()
        targets: tuple[tuple[str, Decimal], ...] = ()
    else:
        weight = total_weight / Decimal(count)
        targets = tuple(sorted((symbol, weight) for symbol in selected))
    return FilteredMomentumSelectionResult(
        scores=tuple(sorted(scores.items())),
        eligible=eligible,
        rejected=rejected,
        ranked=ranked,
        selected=selected,
        targets=targets,
    )
