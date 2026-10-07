from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.compiler.lean.e2e import load_aligned_daily_closes
from ruletrade.strategy.v2.daily_probe import (
    DailyProbeObservation,
    compare_daily_observations,
    lower_daily_value_probe,
    parse_daily_probe_observations,
)
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


def _compare(value: DailyValueNode, snapshot: DailyMarketSnapshot) -> dict[str, str | bool | None]:
    reference_value = DailyValueEvaluator(snapshot).evaluate(value).scalar()
    operator_id = {"observe": "adjusted_close", "trailing_return": "trailing_return", "sma": "sma", "ema": "ema", "rsi_wilder_lean_compat": "rsi_wilder_lean_compat", "realized_volatility": "realized_volatility"}[value.kind]
    reference = DailyProbeObservation(
        semantic_id=value.semantic_id,
        operator_id=operator_id,
        operator_version="1",
        observed_at=snapshot.dates[-1],
        status="available" if reference_value is not None else "not_ready",
        value=reference_value,
        reason=None if reference_value is not None else "insufficient_history",
    )
    artifact = DockerLeanRunner().run(lower_daily_value_probe(value), dataset_id="filter-synthetic")
    observations = parse_daily_probe_observations(artifact.log_text)
    if not observations:
        raise RuntimeError("LEAN probe emitted no structured daily observation")
    differential = compare_daily_observations(reference, observations[-1])
    if not differential.passed:
        raise RuntimeError(f"daily differential failed: {differential}")
    return {
        "semantic_id": differential.semantic_id,
        "operator_id": differential.reference.operator_id,
        "observed_at": differential.lean.observed_at,
        "status": differential.lean.status,
        "reference": str(differential.reference.value),
        "lean": str(differential.lean.value),
        "delta": str(differential.numeric_delta),
        "tolerance": str(differential.absolute_tolerance),
        "passed": differential.passed,
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
    sma = DailyValueNode(
        semantic_id="probe-qqq-sma-5",
        kind="sma",
        operands=(close,),
        observations=5,
    )
    ema = DailyValueNode(
        semantic_id="probe-qqq-ema-5",
        kind="ema",
        operands=(close,),
        observations=5,
    )
    rsi = DailyValueNode(
        semantic_id="probe-qqq-rsi-5",
        kind="rsi_wilder_lean_compat",
        operands=(close,),
        observations=5,
    )
    volatility = DailyValueNode(
        semantic_id="probe-qqq-realized-volatility-5",
        kind="realized_volatility",
        operands=(close,),
        observations=5,
    )
    print(json.dumps({
        "fixture": str(fixture),
        "fixture_price_scale": str(_LEAN_EQUITY_DAILY_PRICE_SCALE),
        "results": [
            _compare(close, snapshot),
            _compare(trailing, snapshot),
            _compare(sma, snapshot),
            _compare(ema, snapshot),
            _compare(rsi, snapshot),
            _compare(volatility, snapshot),
        ],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
