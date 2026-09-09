from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping, Sequence

from ruletrade.strategy.v1.momentum import (
    FallbackMomentumSelectionResult,
    evaluate_fallback_trailing_return_top_n,
)


@dataclass(frozen=True)
class TargetSnapshot:
    sleeve_id: str
    refreshed_at: str
    local_targets: tuple[tuple[str, Decimal], ...]
    growth_decision: FallbackMomentumSelectionResult | None = None


@dataclass(frozen=True)
class PortfolioTemporalDecision:
    event: str
    decision: str
    snapshot_timestamps: tuple[tuple[str, str], ...]
    scaled_contributions: tuple[
        tuple[str, tuple[tuple[str, Decimal], ...]], ...
    ]
    final_targets: tuple[tuple[str, Decimal], ...]


@dataclass(frozen=True)
class IndependentSchedulesResult:
    refreshes: tuple[TargetSnapshot, ...]
    portfolio_events: tuple[PortfolioTemporalDecision, ...]


def evaluate_independent_schedules(
    event_dates: Sequence[str],
    closes_by_date: Mapping[str, Mapping[str, Sequence[Decimal]]],
    *,
    growth_refresh_months: frozenset[int] = frozenset(range(1, 13)),
    defensive_refresh_months: frozenset[int] = frozenset({1, 4, 7, 10}),
    portfolio_months: frozenset[int] = frozenset({1, 4, 7, 10}),
) -> IndependentSchedulesResult:
    """Evaluate refreshes before portfolio execution on every same-day event."""

    latest: dict[str, TargetSnapshot] = {}
    refreshes: list[TargetSnapshot] = []
    portfolio_events: list[PortfolioTemporalDecision] = []
    for event in event_dates:
        month = int(event[5:7])
        closes = closes_by_date[event]

        # Phase 1: all same-day refreshes commit before phase 2 portfolio execution.
        if month in growth_refresh_months:
            growth = evaluate_fallback_trailing_return_top_n(
                closes,
                lookback_bars=126,
                threshold=Decimal(0),
                count=2,
                fallback_asset="TLT",
            )
            snapshot = TargetSnapshot(
                sleeve_id="growth_sleeve",
                refreshed_at=event,
                local_targets=growth.final_targets,
                growth_decision=growth,
            )
            latest[snapshot.sleeve_id] = snapshot
            refreshes.append(snapshot)
        if month in defensive_refresh_months:
            snapshot = TargetSnapshot(
                sleeve_id="defensive_sleeve",
                refreshed_at=event,
                local_targets=(("IEF", Decimal("0.5")), ("TLT", Decimal("0.5"))),
            )
            latest[snapshot.sleeve_id] = snapshot
            refreshes.append(snapshot)

        if month not in portfolio_months:
            continue
        required = ("defensive_sleeve", "growth_sleeve")
        if any(sleeve_id not in latest for sleeve_id in required):
            portfolio_events.append(
                PortfolioTemporalDecision(
                    event=event,
                    decision="skipped",
                    snapshot_timestamps=(),
                    scaled_contributions=(),
                    final_targets=(),
                )
            )
            continue

        factors = {
            "growth_sleeve": Decimal("0.70"),
            "defensive_sleeve": Decimal("0.30"),
        }
        contributions = tuple(
            (
                sleeve_id,
                tuple(
                    (symbol, weight * factors[sleeve_id])
                    for symbol, weight in latest[sleeve_id].local_targets
                ),
            )
            for sleeve_id in required
        )
        aggregated: dict[str, Decimal] = {}
        for _, targets in contributions:
            for symbol, weight in targets:
                aggregated[symbol] = aggregated.get(symbol, Decimal(0)) + weight
        portfolio_events.append(
            PortfolioTemporalDecision(
                event=event,
                decision="executed",
                snapshot_timestamps=tuple(
                    (sleeve_id, latest[sleeve_id].refreshed_at)
                    for sleeve_id in required
                ),
                scaled_contributions=contributions,
                final_targets=tuple(sorted(aggregated.items())),
            )
        )
    return IndependentSchedulesResult(
        refreshes=tuple(refreshes),
        portfolio_events=tuple(portfolio_events),
    )
