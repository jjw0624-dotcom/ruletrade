from __future__ import annotations

from datetime import datetime, timezone
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
    return result / Decimal("100") if percent or is_percent else result


def _timestamp(value: Any) -> datetime:
    if isinstance(value, (int, float)):
        if value > 10_000_000_000:
            value /= 1000
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        candidate = value.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise MalformedLeanResultError(f"invalid equity timestamp: {value!r}") from exc
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    raise MalformedLeanResultError(f"invalid equity timestamp: {value!r}")


def _equity_curve(payload: Any) -> list[EquityPoint]:
    try:
        chart_container = _find_mapping_with_key(payload, "charts")
        if chart_container is None:
            raise KeyError("charts")
        charts = _mapping_value(chart_container, "charts")
        strategy_equity = _mapping_value(charts, "Strategy Equity")
        series = _mapping_value(strategy_equity, "series")
        equity = _mapping_value(series, "Equity")
        values = _mapping_value(equity, "values")
    except (KeyError, TypeError) as exc:
        raise MalformedLeanResultError("LEAN result does not contain Strategy Equity values") from exc
    if not isinstance(values, list) or not values:
        raise MalformedLeanResultError("LEAN Strategy Equity series is empty")
    points: list[EquityPoint] = []
    for item in values:
        if not isinstance(item, dict):
            raise MalformedLeanResultError("LEAN equity point must be an object")
        try:
            points.append(EquityPoint(timestamp=_timestamp(item["x"]), value=_decimal(item["y"])))
        except KeyError as exc:
            raise MalformedLeanResultError("LEAN equity point requires x and y") from exc
    return points


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
