from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Mapping

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry
from ruletrade.strategy.v1.types import normalize_typed_value


def _json_default(value: object) -> str:
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"unsupported parameter binding type: {type(value).__name__}")


def deterministic_random_seed(
    strategy: CanonicalStrategyV1,
    component_id: str,
    *,
    event_identity: str | None = None,
    parameter_bindings: Mapping[str, object] | None = None,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
) -> int:
    """Return the portable seed material contract for a random-selection component."""

    component = next(
        (item for item in strategy.graph.components if item.id == component_id),
        None,
    )
    if component is None:
        raise ValueError(f"unknown component: {component_id}")

    primitive = registry.get(component.primitive)
    if primitive.implementation_id != "selection.random_n_v1":
        raise ValueError(f"component is not a random selection: {component_id}")

    resolved_config = registry.resolve_config(component.primitive, component.config)
    resample = resolved_config["resample"]
    if resample == "per_event" and not event_identity:
        raise ValueError("per_event random selection requires event identity")

    provided_bindings = dict(parameter_bindings or {})
    parameters = {parameter.id: parameter for parameter in strategy.definitions.parameters}
    unknown_bindings = sorted(set(provided_bindings) - set(parameters))
    if unknown_bindings:
        raise ValueError(f"unknown parameter bindings: {', '.join(unknown_bindings)}")
    normalized_bindings = {
        parameter_id: normalize_typed_value(
            provided_bindings.get(parameter_id, parameter.default),
            parameter.value_type,
        )
        for parameter_id, parameter in parameters.items()
    }

    material: dict[str, object] = {
        "strategy": strategy_hash(strategy),
        "component_id": component.id,
        "parameter_bindings": normalized_bindings,
    }
    if resample == "per_event":
        material["event_identity"] = event_identity

    encoded = json.dumps(
        material,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
        default=_json_default,
    ).encode("utf-8")
    digest = hashlib.sha256(encoded).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=False)
