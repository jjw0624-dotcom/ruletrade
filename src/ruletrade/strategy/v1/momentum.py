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


@dataclass(frozen=True)
class FallbackMomentumSelectionResult:
    scores: tuple[tuple[str, Decimal], ...]
    eligible: tuple[str, ...]
    rejected: tuple[str, ...]
    ranked: tuple[str, ...]
    candidate: tuple[str, ...]
    primary_selected: tuple[str, ...]
    fallback_activated: bool
    final_selected: tuple[str, ...]
    final_targets: tuple[tuple[str, Decimal], ...]


@dataclass(frozen=True)
class SleeveAllocationResult:
    sleeve_id: str
    local_selected: tuple[str, ...]
    local_targets: tuple[tuple[str, Decimal], ...]
    allocation: Decimal
    scaled_targets: tuple[tuple[str, Decimal], ...]


@dataclass(frozen=True)
class PortfolioSleevesResult:
    growth: FallbackMomentumSelectionResult
    sleeves: tuple[SleeveAllocationResult, ...]
    final_selected: tuple[str, ...]
    final_targets: tuple[tuple[str, Decimal], ...]


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


def evaluate_fallback_trailing_return_top_n(
    closes: Mapping[str, Sequence[Decimal]],
    *,
    lookback_bars: int,
    threshold: Decimal,
    count: int,
    fallback_asset: str,
    total_weight: Decimal = Decimal(1),
) -> FallbackMomentumSelectionResult:
    """Execute a full primary Top N or replace it with one fallback asset."""

    fallback_asset = fallback_asset.strip().upper()
    if not fallback_asset:
        raise ValueError("fallback_asset is required")
    primary = evaluate_filtered_trailing_return_top_n(
        closes,
        lookback_bars=lookback_bars,
        threshold=threshold,
        count=count,
        total_weight=total_weight,
    )
    candidate = primary.ranked[:count]
    fallback_activated = not primary.selected
    final_selected = (fallback_asset,) if fallback_activated else primary.selected
    final_targets = (
        ((fallback_asset, total_weight),) if fallback_activated else primary.targets
    )
    return FallbackMomentumSelectionResult(
        scores=primary.scores,
        eligible=primary.eligible,
        rejected=primary.rejected,
        ranked=primary.ranked,
        candidate=candidate,
        primary_selected=primary.selected,
        fallback_activated=fallback_activated,
        final_selected=final_selected,
        final_targets=final_targets,
    )


def evaluate_portfolio_sleeves(
    closes: Mapping[str, Sequence[Decimal]],
    *,
    lookback_bars: int = 126,
    threshold: Decimal = Decimal(0),
    count: int = 2,
    fallback_asset: str = "TLT",
    growth_allocation: Decimal = Decimal("0.70"),
    defensive_assets: tuple[str, ...] = ("TLT", "IEF"),
    defensive_allocation: Decimal = Decimal("0.30"),
) -> PortfolioSleevesResult:
    """Reference hierarchical allocation with additive symbol aggregation."""

    growth_allocation = Decimal(growth_allocation)
    defensive_allocation = Decimal(defensive_allocation)
    if growth_allocation + defensive_allocation != Decimal(1):
        raise ValueError("sleeve allocations must sum to 1")
    if not defensive_assets:
        raise ValueError("defensive_assets must not be empty")
    growth = evaluate_fallback_trailing_return_top_n(
        closes,
        lookback_bars=lookback_bars,
        threshold=threshold,
        count=count,
        fallback_asset=fallback_asset,
        total_weight=Decimal(1),
    )
    defensive_local_weight = Decimal(1) / Decimal(len(defensive_assets))
    defensive_local = tuple(
        sorted((symbol, defensive_local_weight) for symbol in defensive_assets)
    )

    def allocation(
        sleeve_id: str,
        selected: tuple[str, ...],
        local_targets: tuple[tuple[str, Decimal], ...],
        factor: Decimal,
    ) -> SleeveAllocationResult:
        return SleeveAllocationResult(
            sleeve_id=sleeve_id,
            local_selected=selected,
            local_targets=local_targets,
            allocation=factor,
            scaled_targets=tuple(
                (symbol, weight * factor) for symbol, weight in local_targets
            ),
        )

    sleeves = (
        allocation(
            "growth_sleeve",
            growth.final_selected,
            growth.final_targets,
            growth_allocation,
        ),
        allocation(
            "defensive_sleeve",
            tuple(sorted(defensive_assets)),
            defensive_local,
            defensive_allocation,
        ),
    )
    aggregated: dict[str, Decimal] = {}
    for sleeve in sleeves:
        for symbol, contribution in sleeve.scaled_targets:
            aggregated[symbol] = aggregated.get(symbol, Decimal(0)) + contribution
    final_targets = tuple(sorted(aggregated.items()))
    if sum((weight for _, weight in final_targets), Decimal(0)) != Decimal(1):
        raise ValueError("final portfolio targets must sum to 1")
    return PortfolioSleevesResult(
        growth=growth,
        sleeves=sleeves,
        final_selected=tuple(symbol for symbol, _ in final_targets),
        final_targets=final_targets,
    )
