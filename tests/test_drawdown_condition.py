import pandas as pd

from ruletrade.conditions.base import ConditionStatus
from ruletrade.conditions.drawdown import evaluate_drawdown
from ruletrade.domain import DrawdownConditionSpec


def prices(values: list[float]) -> pd.DataFrame:
    return pd.DataFrame({"QQQ": values})


def test_drawdown_condition_is_true_when_threshold_is_crossed() -> None:
    condition = DrawdownConditionSpec(
        symbol="QQQ",
        lookback=5,
        threshold="-0.10",
    )

    result = evaluate_drawdown(
        condition,
        prices([90.0, 100.0, 98.0, 95.0, 88.0]),
    )

    assert result.status == ConditionStatus.TRUE
    assert result.observed_value is not None
    assert abs(result.observed_value - (-0.12)) < 1e-12


def test_drawdown_condition_is_false_before_threshold() -> None:
    condition = DrawdownConditionSpec(
        symbol="QQQ",
        lookback=5,
        threshold="-0.10",
    )

    result = evaluate_drawdown(
        condition,
        prices([90.0, 100.0, 98.0, 95.0, 91.0]),
    )

    assert result.status == ConditionStatus.FALSE


def test_drawdown_condition_is_unknown_with_insufficient_history() -> None:
    condition = DrawdownConditionSpec(
        symbol="QQQ",
        lookback=5,
        threshold="-0.10",
    )

    result = evaluate_drawdown(
        condition,
        prices([100.0, 95.0, 88.0]),
    )

    assert result.status == ConditionStatus.UNKNOWN
    assert result.reason == "insufficient history"


def test_drawdown_condition_is_unknown_when_symbol_is_missing() -> None:
    condition = DrawdownConditionSpec(
        symbol="QQQ",
        lookback=2,
        threshold="-0.10",
    )

    result = evaluate_drawdown(
        condition,
        pd.DataFrame({"VOO": [100.0, 90.0]}),
    )

    assert result.status == ConditionStatus.UNKNOWN
    assert result.reason is not None
    assert "QQQ" in result.reason
