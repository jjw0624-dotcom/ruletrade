from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from ruletrade.backtests.errors import MalformedLeanResultError
from ruletrade.backtests.normalization import normalize_lean_result

FIXTURE = Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json"


def _payload() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_normalizes_real_lean_equity_candlesticks_and_timestamps() -> None:
    result = normalize_lean_result(_payload())

    assert [point.timestamp for point in result.equity_curve] == [
        datetime(2024, 1, 1, 5, tzinfo=UTC),
        datetime(2024, 1, 2, 5, tzinfo=UTC),
        datetime(2024, 1, 2, 21, tzinfo=UTC),
    ]
    assert [point.value for point in result.equity_curve] == [
        Decimal("100000.0"),
        Decimal("100000.0"),
        Decimal("100000.0"),
    ]


def test_equity_curve_extracts_candlestick_close() -> None:
    payload = _payload()
    payload["charts"]["Strategy Equity"]["series"]["Equity"]["values"] = [
        [1704085200, 100000.0, 101250.0, 99750.0, 100875.25]
    ]

    result = normalize_lean_result(payload)

    assert result.equity_curve[0].value == Decimal("100875.25")


@pytest.mark.parametrize("values", [[], [1704085200, 100000.0], [1, 2, 3, 4, 5, 6]])
def test_rejects_malformed_equity_array_lengths(values: list[float]) -> None:
    payload = _payload()
    payload["charts"]["Strategy Equity"]["series"]["Equity"]["values"] = [values]

    with pytest.raises(MalformedLeanResultError, match="time, open, high, low, close"):
        normalize_lean_result(payload)


@pytest.mark.parametrize(
    ("point", "message"),
    [
        (["1704085200", 1, 1, 1, 1], "timestamp"),
        ([1704085200, 1, 1, 1, "100000"], "close must be numeric"),
        ([1704085200, 1, float("inf"), 1, 1], "high must be finite"),
    ],
)
def test_rejects_non_numeric_or_non_finite_equity_values(
    point: list[object], message: str
) -> None:
    payload = _payload()
    payload["charts"]["Strategy Equity"]["series"]["Equity"]["values"] = [point]

    with pytest.raises(MalformedLeanResultError, match=message):
        normalize_lean_result(payload)


def test_rejects_missing_strategy_equity_chart() -> None:
    payload = _payload()
    payload["charts"] = {}

    with pytest.raises(MalformedLeanResultError, match="Strategy Equity chart"):
        normalize_lean_result(payload)


def test_rejects_missing_equity_series() -> None:
    payload = _payload()
    payload["charts"]["Strategy Equity"]["series"] = {}

    with pytest.raises(MalformedLeanResultError, match="Equity series"):
        normalize_lean_result(payload)


@pytest.mark.parametrize("point", [{"x": 1704085200, "y": 100000}, "not-a-point", None])
def test_rejects_unsupported_equity_point_representations(point: object) -> None:
    payload = _payload()
    payload["charts"]["Strategy Equity"]["series"]["Equity"]["values"] = [point]

    with pytest.raises(MalformedLeanResultError, match="unsupported"):
        normalize_lean_result(payload)


def test_rejects_legacy_uppercase_chart_container_keys() -> None:
    payload = _payload()
    strategy_equity = payload["charts"]["Strategy Equity"]
    strategy_equity["Series"] = strategy_equity.pop("series")

    with pytest.raises(MalformedLeanResultError, match="series object"):
        normalize_lean_result(payload)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (("statistics", "Statistics"), "statistics object"),
        (("Total Orders", "total orders"), "Total Orders"),
    ],
)
def test_rejects_incorrect_result_or_statistic_key_casing(
    mutation: tuple[str, str], message: str
) -> None:
    payload = _payload()
    original, replacement = mutation
    if original == "statistics":
        payload[replacement] = payload.pop(original)
    else:
        statistics = payload["statistics"]
        statistics[replacement] = statistics.pop(original)

    with pytest.raises(MalformedLeanResultError, match=message):
        normalize_lean_result(payload)


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("Start Equity", 100000, "must be a string"),
        ("Net Profit", "33.448", "must end with"),
        ("Total Orders", "1.5", "must be an integer"),
        ("Total Fees", "73.86", "must start with"),
    ],
)
def test_rejects_non_contract_statistic_shapes(name: str, value: object, message: str) -> None:
    payload = _payload()
    payload["statistics"][name] = value

    with pytest.raises(MalformedLeanResultError, match=message):
        normalize_lean_result(payload)
