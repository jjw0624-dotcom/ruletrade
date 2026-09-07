from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from ruletrade.domain import SimpleStrategySpec
from ruletrade.strategy.models import StrategyDocument
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import (
    BUILTIN_REGISTRY,
    PrimitiveCategory,
    PrimitiveFieldSpec,
)
from ruletrade.strategy.v1.types import ValueType, normalize_typed_value, value_matches_type


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
    for component in graph["components"]:
        try:
            primitive = BUILTIN_REGISTRY.get(component["primitive"])
        except KeyError:
            primitive = None
        if primitive is not None:
            fields = {field.name: field for field in primitive.fields}
            resolved_config = BUILTIN_REGISTRY.resolve_config(
                component["primitive"],
                component["config"],
            )
            component["config"] = {
                key: _normalize_registry_value(value, fields.get(key))
                for key, value in resolved_config.items()
            }
        if component["condition"] is not None:
            component["condition"] = _normalize_v1_ast(component["condition"])
        component["actions"] = [
            _normalize_v1_ast(action) for action in component["actions"]
        ]
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


def _normalize_registry_value(
    value: Any,
    field: PrimitiveFieldSpec | None,
) -> Any:
    if field is None or not value_matches_type(value, field.value_type):
        return value
    return normalize_typed_value(value, field.value_type)


def _normalize_v1_ast(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_v1_ast(item) for item in value]
    if not isinstance(value, dict):
        return value

    normalized = {
        key: _normalize_v1_ast(item)
        for key, item in value.items()
    }
    if normalized.get("kind") == "literal":
        value_type = ValueType(normalized["value_type"])
        normalized["value"] = normalize_typed_value(normalized["value"], value_type)
    if normalized.get("kind") == "indicator":
        try:
            indicator = BUILTIN_REGISTRY.get(normalized["indicator_id"])
        except KeyError:
            indicator = None
        if indicator is not None and indicator.category == PrimitiveCategory.INDICATOR:
            fields = {field.name: field for field in indicator.fields}
            normalized["parameters"] = {
                key: _normalize_registry_value(item, fields.get(key))
                for key, item in normalized["parameters"].items()
            }
    return normalized


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
