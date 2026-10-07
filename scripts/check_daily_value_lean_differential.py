from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.compiler.lean.e2e import load_aligned_daily_closes
from ruletrade.strategy.v2.daily_probe import lower_adjusted_close_probe, parse_daily_probe_observations
from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueEvaluator,
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
)
from ruletrade.strategy.v2.semantic_types import Clock


# LEAN's US equity daily ZIP stores price fields as integer ticks with four
# implied decimal places. LEAN decodes bar.Close to dollars before the probe
# sees it, so the reference adapter must apply the same fixture encoding rule.
_LEAN_EQUITY_DAILY_PRICE_SCALE = Decimal("10000")


def _adjusted_close_snapshot(fixture: Path, symbol: str) -> DailyMarketSnapshot:
    dates, encoded_closes = load_aligned_daily_closes(
        fixture, (symbol,), fixture_name="daily-value-probe"
    )
    normalized_dates = tuple(f"{value[:4]}-{value[4:6]}-{value[6:8]}" for value in dates)
    closes = tuple(value / _LEAN_EQUITY_DAILY_PRICE_SCALE for value in encoded_closes[symbol])
    return DailyMarketSnapshot(
        snapshot_id="lean-filter-data:qqq:adjusted-close-observation@1",
        clock=Clock(id="daily-close"),
        dates=normalized_dates,
        domains={"probe": (symbol,)},
        # This fixture contains no corporate-action divergence. The conversion
        # proves LEAN's four-decimal daily ZIP encoding, not general
        # raw-versus-adjusted corporate-action normalization parity.
        series={symbol: {"close:adjusted": closes}},
    )


def main() -> None:
    fixture = Path("tests/fixtures/lean-filter-data")
    symbol = "QQQ"
    snapshot = _adjusted_close_snapshot(fixture, symbol)
    value = DailyValueNode(
        semantic_id="probe-qqq-adjusted-close",
        kind="observe",
        subject_kind=SubjectKind.ASSET,
        subject_id=symbol,
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )
    reference = DailyValueEvaluator(snapshot).evaluate(value).scalar()
    artifact = DockerLeanRunner().run(lower_adjusted_close_probe(value), dataset_id="filter-synthetic")
    observations = parse_daily_probe_observations(artifact.log_text)
    if not observations:
        raise RuntimeError("LEAN probe emitted no structured daily observation")
    observed = observations[-1]
    if observed.semantic_id != value.semantic_id or observed.status != "available":
        raise RuntimeError(f"unexpected LEAN probe observation: {observed}")
    if observed.value != reference:
        raise RuntimeError(f"daily adjusted-close mismatch: reference={reference} lean={observed.value}")
    print(json.dumps({
        "semantic_id": observed.semantic_id,
        "observed_at": observed.observed_at,
        "status": observed.status,
        "reference": str(reference),
        "lean": str(observed.value),
        "delta": str(abs((observed.value or Decimal(0)) - reference)),
        "fixture": str(fixture),
        "fixture_price_scale": str(_LEAN_EQUITY_DAILY_PRICE_SCALE),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
