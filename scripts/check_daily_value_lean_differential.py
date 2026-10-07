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


def main() -> None:
    fixture = Path("tests/fixtures/lean-filter-data")
    symbol = "QQQ"
    dates, closes = load_aligned_daily_closes(fixture, (symbol,), fixture_name="daily-value-probe")
    normalized_dates = tuple(f"{value[:4]}-{value[4:6]}-{value[6:8]}" for value in dates)
    snapshot = DailyMarketSnapshot(
        snapshot_id="lean-filter-data:qqq:adjusted-close-observation@1",
        clock=Clock(id="daily-close"),
        dates=normalized_dates,
        domains={"probe": (symbol,)},
        # The fixture has no corporate action; this is an adjusted-close
        # plumbing proof, not a raw/adjusted divergence proof.
        series={symbol: {"close:adjusted": tuple(closes[symbol])}},
    )
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
    }, sort_keys=True))


if __name__ == "__main__":
    main()
