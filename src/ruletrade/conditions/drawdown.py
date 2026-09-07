from __future__ import annotations

import pandas as pd

from ruletrade.conditions.base import ConditionEvaluation, ConditionStatus
from ruletrade.domain import ComparisonOperator, DrawdownConditionSpec


def _compare(value: float, operator: ComparisonOperator, threshold: float) -> bool:
    if operator == ComparisonOperator.LESS_THAN:
        return value < threshold
    if operator == ComparisonOperator.LESS_EQUAL:
        return value <= threshold
    if operator == ComparisonOperator.GREATER_THAN:
        return value > threshold
    if operator == ComparisonOperator.GREATER_EQUAL:
        return value >= threshold
    raise ValueError(f"unsupported comparison operator: {operator}")


def evaluate_drawdown(
    condition: DrawdownConditionSpec,
    prices: pd.DataFrame,
) -> ConditionEvaluation:
    if condition.symbol not in prices.columns:
        return ConditionEvaluation(
            status=ConditionStatus.UNKNOWN,
            condition_type=condition.type,
            threshold=float(condition.threshold),
            reason=f"symbol not found in market data: {condition.symbol}",
        )

    series = prices[condition.symbol]

    if len(series) < condition.lookback:
        return ConditionEvaluation(
            status=ConditionStatus.UNKNOWN,
            condition_type=condition.type,
            threshold=float(condition.threshold),
            details={
                "symbol": condition.symbol,
                "lookback": condition.lookback,
                "available_observations": len(series),
            },
            reason="insufficient history",
        )

    window = series.iloc[-condition.lookback:]
    peak = float(window.max())
    current = float(window.iloc[-1])
    drawdown = current / peak - 1.0
    threshold = float(condition.threshold)

    matched = _compare(drawdown, condition.operator, threshold)

    return ConditionEvaluation(
        status=ConditionStatus.TRUE if matched else ConditionStatus.FALSE,
        condition_type=condition.type,
        observed_value=drawdown,
        threshold=threshold,
        details={
            "symbol": condition.symbol,
            "lookback": condition.lookback,
            "operator": condition.operator.value,
            "current_price": current,
            "peak_price": peak,
        },
    )
