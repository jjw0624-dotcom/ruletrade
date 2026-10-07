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


def _operator_id(value: DailyValueNode) -> str:
    return {
        "observe": "adjusted_close",
        "trailing_return": "trailing_return",
        "sma": "sma",
        "ema": "ema",
        "rsi_wilder_lean_compat": "rsi_wilder_lean_compat",
        "realized_volatility": "realized_volatility",
    }[value.kind]


def _reference_observation(
    value: DailyValueNode,
    snapshot: DailyMarketSnapshot,
    cutoff_index: int,
) -> DailyProbeObservation:
    reference_value = DailyValueEvaluator(
        snapshot, cutoff_index=cutoff_index
    ).evaluate(value).scalar()
    return DailyProbeObservation(
        semantic_id=value.semantic_id,
        operator_id=_operator_id(value),
        operator_version="1",
        observed_at=snapshot.dates[cutoff_index],
        status="available" if reference_value is not None else "not_ready",
        value=reference_value,
        reason=None if reference_value is not None else "insufficient_history",
    )


def _lean_observation(
    value: DailyValueNode,
    requested_date: str,
) -> DailyProbeObservation:
    artifact = DockerLeanRunner().run(
        lower_daily_value_probe(value, requested_date=requested_date),
        dataset_id="filter-synthetic",
    )
    observations = parse_daily_probe_observations(artifact.log_text)
    if len(observations) != 1:
        raise RuntimeError(
            f"LEAN probe expected one observation, received {len(observations)}"
        )
    return observations[0]


def _compare(
    value: DailyValueNode,
    snapshot: DailyMarketSnapshot,
    *,
    cutoff_index: int | None = None,
) -> dict[str, str | bool | None]:
    index = len(snapshot.dates) - 1 if cutoff_index is None else cutoff_index
    reference = _reference_observation(value, snapshot, index)
    lean = _lean_observation(value, reference.observed_at)
    differential = compare_daily_observations(reference, lean)
    if not differential.passed:
        raise RuntimeError(f"daily differential failed: {differential}")

    threshold = None
    reference_outcome = None
    lean_outcome = None
    if reference.value is not None and lean.value is not None:
        guard = max(differential.absolute_tolerance * Decimal(10), Decimal("1e-10"))
        threshold = reference.value - guard
        reference_outcome = reference.value > threshold
        lean_outcome = lean.value > threshold
        if reference_outcome != lean_outcome:
            raise RuntimeError("threshold-adjacent comparison outcome mismatch")

    return {
        "semantic_id": differential.semantic_id,
        "operator_id": differential.reference.operator_id,
        "observed_at": differential.lean.observed_at,
        "status": differential.lean.status,
        "reference": str(differential.reference.value),
        "lean": str(differential.lean.value),
        "delta": str(differential.numeric_delta),
        "tolerance": str(differential.absolute_tolerance),
        "comparison_threshold": None if threshold is None else str(threshold),
        "reference_outcome": reference_outcome,
        "lean_outcome": lean_outcome,
        "passed": differential.passed,
    }


def _verify_missing(
    value: DailyValueNode,
    requested_date: str,
) -> dict[str, str | bool | None]:
    reference = DailyProbeObservation(
        semantic_id=value.semantic_id,
        operator_id=_operator_id(value),
        operator_version="1",
        observed_at=requested_date,
        status="unavailable",
        value=None,
        reason="missing_completed_bar",
    )
    lean = _lean_observation(value, requested_date)
    differential = compare_daily_observations(reference, lean)
    if not differential.passed or lean.value is not None:
        raise RuntimeError(f"missing observation differential failed: {differential}")
    return {
        "observed_at": requested_date,
        "status": lean.status,
        "value": None,
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
    results = [
        _compare(close, snapshot),
        _compare(trailing, snapshot),
        _compare(sma, snapshot),
        _compare(ema, snapshot),
        _compare(rsi, snapshot),
        _compare(volatility, snapshot),
    ]
    earlier_index = len(snapshot.dates) // 2
    earlier = _compare(close, snapshot, cutoff_index=earlier_index)
    repeated = _lean_observation(close, snapshot.dates[earlier_index])
    if (
        repeated.value != Decimal(earlier["lean"])
        or repeated.status != earlier["status"]
        or repeated.observed_at != earlier["observed_at"]
    ):
        raise RuntimeError("repeated Docker LEAN observation was not deterministic")
    missing = _verify_missing(close, "2024-06-30")

    print(json.dumps({
        "fixture": str(fixture),
        "fixture_price_scale": str(_LEAN_EQUITY_DAILY_PRICE_SCALE),
        "results": results,
        "earlier_cutoff_and_future_extension": earlier,
        "missing": missing,
        "repeated_run_deterministic": True,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
