from __future__ import annotations

import math
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from ruletrade.backtests.errors import MalformedLeanResultError
from ruletrade.backtests.models import BacktestResult, EquityPoint


def _mapping_value(mapping: dict[str, Any], name: str) -> Any:
    lowered = name.casefold()
    for key, value in mapping.items():
        if key.casefold() == lowered:
            return value
    raise KeyError(name)


def _find_mapping_with_key(value: Any, key: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if any(item.casefold() == key.casefold() for item in value):
            return value
        for child in value.values():
            found = _find_mapping_with_key(child, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_mapping_with_key(child, key)
            if found is not None:
                return found
    return None


def _decimal(value: Any, *, percent: bool = False) -> Decimal:
    cleaned = str(value).strip().replace(",", "").replace("$", "")
    is_percent = cleaned.endswith("%")
    cleaned = cleaned.removesuffix("%")
    try:
        result = Decimal(cleaned)
    except InvalidOperation as exc:
        raise MalformedLeanResultError(f"LEAN statistic is not numeric: {value!r}") from exc
    return result / Decimal(100) if percent or is_percent else result


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


def _equity_curve(payload: Any) -> list[EquityPoint]:
    try:
        charts = payload["charts"]
    except (KeyError, TypeError) as exc:
        raise MalformedLeanResultError("LEAN result does not contain charts") from exc
    try:
        strategy_equity = charts["Strategy Equity"]
    except (KeyError, TypeError) as exc:
        raise MalformedLeanResultError("LEAN result does not contain Strategy Equity chart") from exc
    try:
        equity = strategy_equity["Series"]["Equity"]
    except (KeyError, TypeError) as exc:
        raise MalformedLeanResultError("LEAN Strategy Equity chart does not contain Equity series") from exc
    try:
        values = equity["Values"]
    except (KeyError, TypeError) as exc:
        raise MalformedLeanResultError("LEAN Equity series does not contain Values") from exc
    if not isinstance(values, list) or not values:
        raise MalformedLeanResultError("LEAN Strategy Equity series is empty")
    return [_equity_point(item) for item in values]


def normalize_lean_result(payload: Any) -> BacktestResult:
    if not isinstance(payload, dict):
        raise MalformedLeanResultError("LEAN result must be a JSON object")
    statistics = _find_mapping_with_key(payload, "Total Orders")
    if statistics is None:
        raise MalformedLeanResultError("LEAN result does not contain statistics")
    equity_curve = _equity_curve(payload)
    try:
        initial_value = _decimal(_mapping_value(statistics, "Start Equity"))
        final_value = _decimal(_mapping_value(statistics, "End Equity"))
        total_return = _decimal(_mapping_value(statistics, "Net Profit"), percent=True)
        total_orders = int(_decimal(_mapping_value(statistics, "Total Orders")))
        total_fees = _decimal(_mapping_value(statistics, "Total Fees"))
    except KeyError as exc:
        raise MalformedLeanResultError(f"LEAN result is missing statistic {exc.args[0]}") from exc
    return BacktestResult(
        initial_value=initial_value,
        final_value=final_value,
        total_return=total_return,
        total_orders=total_orders,
        total_fees=total_fees,
        equity_curve=equity_curve,
    )
