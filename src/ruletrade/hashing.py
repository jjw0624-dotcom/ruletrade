from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from ruletrade.domain import SimpleStrategySpec
from ruletrade.strategy.models import StrategyDocument
from ruletrade.strategy.v1.models import CanonicalStrategyV1


HashableStrategy = SimpleStrategySpec | StrategyDocument | CanonicalStrategyV1


def _decimal_text(value: Decimal) -> str:
    normalized = value.normalize()
    text = format(normalized, "f")
    return "0" if text == "-0" else text


def _simple_semantic_payload(
    spec: SimpleStrategySpec,
) -> dict[str, Any]:
    # Keep the original SimpleStrategySpec hashing semantics unchanged.
    return {
        "api_version": spec.api_version,
        "currency": spec.currency,
        "initial_capital": _decimal_text(spec.initial_capital),
        "recurring_contribution": (
            None
            if spec.recurring_contribution is None
            else {
                "amount": _decimal_text(
                    spec.recurring_contribution.amount
                ),
                "frequency": spec.recurring_contribution.frequency,
            }
        ),
        "rebalance": spec.rebalance.value,
        "assets": [
            {
                "symbol": asset.symbol,
                "weight": _decimal_text(asset.weight),
            }
            for asset in sorted(
                spec.assets,
                key=lambda item: item.symbol,
            )
        ],
    }


def _core_semantic_payload(
    spec: StrategyDocument,
) -> dict[str, Any]:
    payload = spec.model_dump(
        mode="python",
        exclude={"name"},
    )

    return _normalize_value(payload)


def _v1_semantic_payload(
    spec: CanonicalStrategyV1,
) -> dict[str, Any]:
    payload = spec.model_dump(
        mode="python",
        exclude={"metadata"},
    )

    definitions = payload["definitions"]
    for collection in ("asset_sets", "parameters", "state"):
        definitions[collection] = sorted(
            definitions[collection],
            key=lambda item: item["id"],
        )

    graph = payload["graph"]
    graph["components"] = sorted(
        graph["components"],
        key=lambda item: item["id"],
    )
    graph["connections"] = sorted(
        graph["connections"],
        key=lambda item: (
            item["source"]["component_id"],
            item["source"]["port"],
            item["target"]["component_id"],
            item["target"]["port"],
        ),
    )
    payload["entrypoints"] = sorted(
        payload["entrypoints"],
        key=lambda item: (
            item["event_component_id"],
            item["target_component_id"],
        ),
    )

    return _normalize_value(payload)


def _normalize_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return _decimal_text(value)

    if isinstance(value, dict):
        return {
            str(key): _normalize_value(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            _normalize_value(item)
            for item in value
        ]

    return value


def semantic_payload(
    spec: HashableStrategy,
) -> dict[str, Any]:
    if isinstance(spec, SimpleStrategySpec):
        return _simple_semantic_payload(spec)

    if isinstance(spec, StrategyDocument):
        return _core_semantic_payload(spec)

    if isinstance(spec, CanonicalStrategyV1):
        return _v1_semantic_payload(spec)

    raise TypeError(
        f"unsupported strategy type: {type(spec).__name__}"
    )


def canonical_json(
    spec: HashableStrategy,
) -> str:
    return json.dumps(
        semantic_payload(spec),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def strategy_hash(
    spec: HashableStrategy,
) -> str:
    digest = hashlib.sha256(
        canonical_json(spec).encode("utf-8")
    ).hexdigest()

    return f"sha256:{digest}"
