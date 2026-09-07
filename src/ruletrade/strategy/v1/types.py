from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any


class ValueType(StrEnum):
    """Semantic value types shared by the canonical graph and AST."""

    BOOLEAN = "boolean"
    INTEGER = "integer"
    DECIMAL = "decimal"
    PERCENTAGE = "percentage"
    STRING = "string"
    ASSET = "asset"
    ASSET_SET = "asset_set"
    SHARES = "shares"
    MONEY = "money"
    MONEY_PER_SHARE = "money_per_share"
    PORTFOLIO_TARGETS = "portfolio_targets"
    DATETIME = "datetime"
    DURATION = "duration"


NUMERIC_TYPES = frozenset(
    {
        ValueType.INTEGER,
        ValueType.DECIMAL,
        ValueType.PERCENTAGE,
        ValueType.SHARES,
        ValueType.MONEY,
        ValueType.MONEY_PER_SHARE,
    }
)


def value_matches_type(value: Any, value_type: ValueType) -> bool:
    if value_type == ValueType.BOOLEAN:
        return isinstance(value, bool)
    if value_type == ValueType.INTEGER:
        return isinstance(value, int) and not isinstance(value, bool)
    if value_type in {
        ValueType.DECIMAL,
        ValueType.PERCENTAGE,
        ValueType.SHARES,
        ValueType.MONEY,
        ValueType.MONEY_PER_SHARE,
    }:
        if isinstance(value, bool):
            return False
        try:
            Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return False
        return True
    if value_type in {ValueType.STRING, ValueType.ASSET}:
        return isinstance(value, str) and bool(value.strip())
    if value_type == ValueType.ASSET_SET:
        return (
            isinstance(value, list)
            and bool(value)
            and all(isinstance(item, str) and bool(item.strip()) for item in value)
        )
    if value_type == ValueType.PORTFOLIO_TARGETS:
        return isinstance(value, dict) and all(
            isinstance(symbol, str)
            and bool(symbol.strip())
            and value_matches_type(weight, ValueType.PERCENTAGE)
            for symbol, weight in value.items()
        )
    if value_type == ValueType.DATETIME:
        if isinstance(value, datetime):
            return True
        if not isinstance(value, str):
            return False
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return False
        return True
    if value_type == ValueType.DURATION:
        return (
            isinstance(value, int)
            and not isinstance(value, bool)
            and value >= 0
        ) or (isinstance(value, str) and bool(value.strip()))
    return False


def normalize_typed_value(value: Any, value_type: ValueType) -> Any:
    if not value_matches_type(value, value_type):
        raise ValueError(f"value does not match {value_type}")
    if value_type in {
        ValueType.DECIMAL,
        ValueType.PERCENTAGE,
        ValueType.SHARES,
        ValueType.MONEY,
        ValueType.MONEY_PER_SHARE,
    }:
        return Decimal(str(value))
    if value_type == ValueType.ASSET:
        return value.strip().upper()
    if value_type == ValueType.ASSET_SET:
        return [item.strip().upper() for item in value]
    if value_type == ValueType.PORTFOLIO_TARGETS:
        return {
            symbol.strip().upper(): Decimal(str(weight))
            for symbol, weight in value.items()
        }
    return value
