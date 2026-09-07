from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveCategory, PrimitiveRegistry
from ruletrade.strategy.v1.validation import validate_strategy_v1


@dataclass(frozen=True)
class LeanSubscriptionRequirement:
    symbol: str
    security_type: Literal["equity"] = "equity"
    market: Literal["usa"] = "usa"
    resolution: Literal["daily"] = "daily"


@dataclass(frozen=True)
class LeanEventRequirement:
    component_id: str
    implementation_id: str
    config: tuple[tuple[str, object], ...]


@dataclass(frozen=True)
class StrategyDependencies:
    subscriptions: tuple[LeanSubscriptionRequirement, ...]
    events: tuple[LeanEventRequirement, ...]
    primitive_implementations: tuple[str, ...]
    state_support: tuple[str, ...]
    helper_support: tuple[str, ...]


def analyze_dependencies(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
) -> StrategyDependencies:
    """Collect backend requirements without deciding how LEAN implements them."""

    validate_strategy_v1(strategy, registry)
    asset_sets = {item.id: item for item in strategy.definitions.asset_sets}
    subscriptions: dict[str, LeanSubscriptionRequirement] = {}
    events: list[LeanEventRequirement] = []
    implementation_ids: set[str] = set()
    helpers: set[str] = set()

    for component in strategy.graph.components:
        primitive = registry.get(component.primitive)
        implementation_ids.add(primitive.implementation_id)
        config = registry.resolve_config(component.primitive, component.config)

        if primitive.implementation_id == "asset_set.named":
            for symbol in asset_sets[str(config["asset_set_ref"])].assets:
                subscriptions.setdefault(symbol, LeanSubscriptionRequirement(symbol=symbol))
        if primitive.category == PrimitiveCategory.EVENT:
            events.append(
                LeanEventRequirement(
                    component_id=component.id,
                    implementation_id=primitive.implementation_id,
                    config=tuple(sorted(config.items())),
                )
            )
        if primitive.implementation_id == "selection.random_n_v1":
            helpers.update(("sha256_seed", "python_random_sample"))

    return StrategyDependencies(
        subscriptions=tuple(subscriptions[key] for key in sorted(subscriptions)),
        events=tuple(sorted(events, key=lambda item: item.component_id)),
        primitive_implementations=tuple(sorted(implementation_ids)),
        state_support=tuple(sorted(definition.id for definition in strategy.definitions.state)),
        helper_support=tuple(sorted(helpers)),
    )
