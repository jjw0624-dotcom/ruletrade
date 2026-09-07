from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from ruletrade.domain import SimpleStrategySpec


def _decimal_text(value: Decimal) -> str:
    normalized = value.normalize()
    text = format(normalized, "f")
    return "0" if text == "-0" else text


def semantic_payload(spec: SimpleStrategySpec) -> dict[str, Any]:
    return {
        "api_version": spec.api_version,
        "currency": spec.currency,
        "initial_capital": _decimal_text(spec.initial_capital),
        "recurring_contribution": (
            None
            if spec.recurring_contribution is None
            else {
                "amount": _decimal_text(spec.recurring_contribution.amount),
                "frequency": spec.recurring_contribution.frequency,
            }
        ),
        "rebalance": spec.rebalance.value,
        "assets": [
            {"symbol": asset.symbol, "weight": _decimal_text(asset.weight)}
            for asset in sorted(spec.assets, key=lambda item: item.symbol)
        ],
    }


def canonical_json(spec: SimpleStrategySpec) -> str:
    return json.dumps(semantic_payload(spec), ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def strategy_hash(spec: SimpleStrategySpec) -> str:
    digest = hashlib.sha256(canonical_json(spec).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"
