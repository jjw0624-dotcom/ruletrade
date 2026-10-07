from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.compiler.lean.e2e import load_aligned_daily_closes
from ruletrade.strategy.v2.daily_probe import lower_daily_value_probe, parse_daily_probe_observations
from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueEvaluator,
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
)
from ruletrade.strategy.v2.semantic_types import Clock


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
        series={symbol: {"close:adjusted": closes}},
    )


def _compare(value: DailyValueNode, snapshot: DailyMarketSnapshot) -> dict[str, str]:
    reference_result = DailyValueEvaluator(snapshot).evaluate(value)
    reference = reference_result.scalar()
    expected_status = "available" if reference is not None else "not_ready"
    artifact = DockerLeanRunner().run(lower_daily_value_probe(value), dataset_id="filter-synthetic")
    observations = parse_daily_probe_observations(artifact.log_text)
    if not observations:
        raise RuntimeError("LEAN probe emitted no structured daily observation")
    observed = observations[-1]
    expected_at = snapshot.dates[-1]
    if (
        observed.semantic_id != value.semantic_id
        or observed.operator_id != ("adjusted_close" if value.kind == "observe" else "trailing_return")
        or observed.operator_version != "1"
        or observed.observed_at != expected_at
        or observed.status != expected_status
    ):
        raise RuntimeError(f"daily observation metadata mismatch: reference={expected_at}/{expected_status} lean={observed}")
    if observed.value != reference:
        raise RuntimeError(f"daily value mismatch for {value.semantic_id}: reference={reference} lean={observed.value}")
    return {
        "semantic_id": observed.semantic_id,
        "operator_id": observed.operator_id,
        "observed_at": observed.observed_at,
        "status": observed.status,
        "reference": str(reference),
        "lean": str(observed.value),
        "delta": str(abs((observed.value or Decimal(0)) - (reference or Decimal(0)))),
    }


def main() -> None:
    fixture = Path("tests/fixtures/lean-filter-data")
    symbol = "QQQ"
    snapshot = _adjusted_close_snapshot(fixture, symbol)
    close = DailyValueNode(
        semantic_id="probe-qqq-adjusted-close",
        kind="observe",
        subject_kind=SubjectKind.ASSET,
        subject_id=symbol,
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )
    trailing = DailyValueNode(
        semantic_id="probe-qqq-trailing-return-5",
        kind="trailing_return",
        operands=(close,),
        observations=5,
    )
    results = [_compare(close, snapshot), _compare(trailing, snapshot)]
    print(json.dumps({
        "fixture": str(fixture),
        "fixture_price_scale": str(_LEAN_EQUITY_DAILY_PRICE_SCALE),
        "results": results,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
