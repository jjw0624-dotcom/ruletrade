from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from decimal import Decimal

from ruletrade.backtests.errors import MalformedLeanResultError
from ruletrade.backtests.models import BacktestResult, EquityPoint


_NUMBER = re.compile(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?")
_NONNEGATIVE_INTEGER = re.compile(r"\d+")


def _statistic(statistics: dict[object, object], name: str) -> str:
    if name not in statistics:
        raise MalformedLeanResultError(f"LEAN result is missing statistic {name}")
    value = statistics[name]
    if not isinstance(value, str):
        raise MalformedLeanResultError(f"LEAN statistic {name} must be a string")
    return value


def _formatted_decimal(
    value: str,
    name: str,
    *,
    prefix: str = "",
    suffix: str = "",
) -> Decimal:
    cleaned = value.strip()
    if prefix and not cleaned.startswith(prefix):
        raise MalformedLeanResultError(f"LEAN statistic {name} must start with {prefix!r}")
    if suffix and not cleaned.endswith(suffix):
        raise MalformedLeanResultError(f"LEAN statistic {name} must end with {suffix!r}")
    if prefix:
        cleaned = cleaned[len(prefix) :]
    if suffix:
        cleaned = cleaned[: -len(suffix)]
    if _NUMBER.fullmatch(cleaned) is None:
        raise MalformedLeanResultError(f"LEAN statistic {name} is not numeric: {value!r}")
    result = Decimal(cleaned.replace(",", ""))
    return result / Decimal(100) if suffix == "%" else result


def _order_count(value: str) -> int:
    cleaned = value.strip()
    if _NONNEGATIVE_INTEGER.fullmatch(cleaned) is None:
        raise MalformedLeanResultError("LEAN statistic Total Orders must be an integer")
    return int(cleaned)


def _candlestick_number(value: object, field: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MalformedLeanResultError(f"LEAN equity {field} must be numeric")
    if isinstance(value, float) and not math.isfinite(value):
        raise MalformedLeanResultError(f"LEAN equity {field} must be finite")
    return Decimal(str(value))


def _candlestick_timestamp(value: object) -> datetime:
    if isinstance(value, bool) or not isinstance(value, int):
        raise MalformedLeanResultError("LEAN equity timestamp must be integer Unix seconds")
    try:
        return datetime.fromtimestamp(value, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise MalformedLeanResultError(f"invalid LEAN equity timestamp: {value!r}") from exc


def _equity_point(value: object) -> EquityPoint:
    if not isinstance(value, list):
        raise MalformedLeanResultError("unsupported LEAN equity point representation")
    if len(value) != 5:
        raise MalformedLeanResultError(
            "LEAN equity candlestick must contain [time, open, high, low, close]"
        )
    timestamp, open_value, high, low, close = value
    _candlestick_number(open_value, "open")
    _candlestick_number(high, "high")
    _candlestick_number(low, "low")
    return EquityPoint(
        timestamp=_candlestick_timestamp(timestamp),
        value=_candlestick_number(close, "close"),
    )


def _equity_curve(payload: dict[object, object]) -> list[EquityPoint]:
    charts = payload.get("charts")
    if not isinstance(charts, dict):
        raise MalformedLeanResultError("LEAN result does not contain charts object")
    strategy_equity = charts.get("Strategy Equity")
    if not isinstance(strategy_equity, dict):
        raise MalformedLeanResultError("LEAN result does not contain Strategy Equity chart")
    series = strategy_equity.get("series")
    if not isinstance(series, dict):
        raise MalformedLeanResultError("LEAN Strategy Equity chart does not contain series object")
    equity = series.get("Equity")
    if not isinstance(equity, dict):
        raise MalformedLeanResultError("LEAN Strategy Equity chart does not contain Equity series")
    values = equity.get("values")
    if values is None:
        raise MalformedLeanResultError("LEAN Equity series does not contain values")
    if not isinstance(values, list) or not values:
        raise MalformedLeanResultError("LEAN Strategy Equity series is empty")
    return [_equity_point(item) for item in values]


def normalize_lean_result(payload: object) -> BacktestResult:
    if not isinstance(payload, dict):
        raise MalformedLeanResultError("LEAN result must be a JSON object")
    statistics = payload.get("statistics")
    if not isinstance(statistics, dict):
        raise MalformedLeanResultError("LEAN result does not contain statistics object")
    equity_curve = _equity_curve(payload)
    initial_value = _formatted_decimal(
        _statistic(statistics, "Start Equity"), "Start Equity"
    )
    final_value = _formatted_decimal(_statistic(statistics, "End Equity"), "End Equity")
    total_return = _formatted_decimal(
        _statistic(statistics, "Net Profit"), "Net Profit", suffix="%"
    )
    total_orders = _order_count(_statistic(statistics, "Total Orders"))
    total_fees = _formatted_decimal(
        _statistic(statistics, "Total Fees"), "Total Fees", prefix="$"
    )
    return BacktestResult(
        initial_value=initial_value,
        final_value=final_value,
        total_return=total_return,
        total_orders=total_orders,
        total_fees=total_fees,
        equity_curve=equity_curve,
    )
