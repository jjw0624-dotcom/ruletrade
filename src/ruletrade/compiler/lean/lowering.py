from __future__ import annotations

from decimal import Decimal
from typing import Literal, Mapping, cast

from ruletrade.compiler.lean.analysis import analyze_dependencies
from ruletrade.compiler.lean.plan import (
    LeanMonthlyEvent,
    LeanPlan,
    LeanRandomSelection,
    LeanRebalance,
    LeanSubscription,
    LeanTargetSleeve,
    normalize_lean_plan,
)
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.models import CanonicalStrategyV1, Component
from ruletrade.strategy.v1.randomness import canonical_parameter_bindings_json
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry


SUPPORTED_IMPLEMENTATIONS = frozenset(
    {
        "event.monthly",
        "asset_set.named",
        "selection.random_n_v1",
        "allocation.equal_weight",
        "targets.merge",
        "effect.rebalance",
    }
)


class LeanLoweringError(ValueError):
    pass


def lower_to_lean_plan(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
    *,
    parameter_bindings: Mapping[str, object] | None = None,
) -> LeanPlan:
    dependencies = analyze_dependencies(strategy, registry)
    components = {item.id: item for item in strategy.graph.components}
    asset_sets = {item.id: tuple(item.assets) for item in strategy.definitions.asset_sets}
    inputs = {
        (connection.target.component_id, connection.target.port): connection.source.component_id
        for connection in strategy.graph.connections
    }
    used_component_ids: set[str] = set()

    implementations = {
        component.id: registry.get(component.primitive).implementation_id
        for component in strategy.graph.components
    }
    unsupported = sorted(set(implementations.values()) - SUPPORTED_IMPLEMENTATIONS)
    if unsupported:
        raise LeanLoweringError(f"unsupported LEAN v0 primitive implementations: {', '.join(unsupported)}")
    if strategy.definitions.state:
        raise LeanLoweringError("LEAN compiler v0 does not support state definitions")

    def config(component: Component) -> dict[str, object]:
        return registry.resolve_config(component.primitive, component.config)

    def source(component_id: str, port: str) -> Component:
        try:
            result = components[inputs[(component_id, port)]]
            used_component_ids.add(result.id)
            return result
        except KeyError as exc:
            raise LeanLoweringError(f"missing source for {component_id}.{port}") from exc

    selections: dict[str, LeanRandomSelection] = {}
    sleeves: dict[str, LeanTargetSleeve] = {}

    def lower_sleeve(component: Component) -> LeanTargetSleeve:
        if implementations[component.id] != "allocation.equal_weight":
            raise LeanLoweringError(f"{component.id} is not an equal-weight allocator")
        upstream = source(component.id, "assets")
        selection_id: str | None = None
        if implementations[upstream.id] == "selection.random_n_v1":
            asset_component = source(upstream.id, "assets")
            if implementations[asset_component.id] != "asset_set.named":
                raise LeanLoweringError("random selection input must be a named asset set")
            symbols = asset_sets[str(config(asset_component)["asset_set_ref"])]
            selection_config = config(upstream)
            count = int(selection_config["count"])
            if count > len(symbols):
                raise LeanLoweringError("RandomSelect count cannot exceed its asset set size")
            resample_value = str(selection_config["resample"])
            if resample_value not in {"once", "per_event"}:
                raise LeanLoweringError(f"unsupported RandomSelect resample: {resample_value}")
            selection_id = upstream.id
            selections[selection_id] = LeanRandomSelection(
                id=selection_id,
                component_id=upstream.id,
                symbols=symbols,
                count=count,
                resample=cast(Literal["once", "per_event"], resample_value),
                parameter_bindings_json=canonical_parameter_bindings_json(
                    strategy,
                    parameter_bindings,
                ),
            )
        elif implementations[upstream.id] == "asset_set.named":
            symbols = asset_sets[str(config(upstream)["asset_set_ref"])]
        else:
            raise LeanLoweringError("equal-weight input must be a named asset set or RandomSelect")

        sleeve = LeanTargetSleeve(
            id=component.id,
            symbols=symbols,
            total_weight=Decimal(str(config(component)["total"])),
            selection_id=selection_id,
        )
        sleeves[sleeve.id] = sleeve
        return sleeve

    rebalances: dict[str, LeanRebalance] = {}
    monthly_events: list[LeanMonthlyEvent] = []
    for entrypoint in strategy.entrypoints:
        event = components[entrypoint.event_component_id]
        target = components[entrypoint.target_component_id]
        used_component_ids.update((event.id, target.id))
        if implementations[event.id] != "event.monthly":
            raise LeanLoweringError("LEAN compiler v0 supports only monthly events")
        day = int(config(event)["day"])
        if day != 1:
            raise LeanLoweringError("LEAN compiler v0 supports only the first trading day of the month")
        if implementations[target.id] != "effect.rebalance":
            raise LeanLoweringError("monthly entrypoint must target Rebalance")
        merge = source(target.id, "targets")
        if implementations[merge.id] != "targets.merge":
            raise LeanLoweringError("Rebalance input must be MergeTargets")
        left = lower_sleeve(source(merge.id, "left"))
        right = lower_sleeve(source(merge.id, "right"))
        if left.total_weight + right.total_weight != Decimal("1"):
            raise LeanLoweringError("merged target sleeve weights must sum to 1")
        rebalances[target.id] = LeanRebalance(id=target.id, sleeve_ids=(left.id, right.id))
        monthly_events.append(
            LeanMonthlyEvent(
                id=event.id,
                day=day,
                anchor_symbol=dependencies.subscriptions[0].symbol,
                rebalance_ids=(target.id,),
            )
        )

    unused = sorted(set(components) - used_component_ids)
    if unused:
        raise LeanLoweringError(f"LEAN compiler v0 does not support unused components: {', '.join(unused)}")

    return normalize_lean_plan(
        LeanPlan(
            strategy_identity=strategy_hash(strategy),
            subscriptions=tuple(
                LeanSubscription(
                    symbol=item.symbol,
                    security_type=item.security_type,
                    market=item.market,
                    resolution=item.resolution,
                )
                for item in dependencies.subscriptions
            ),
            random_selections=tuple(selections.values()),
            target_sleeves=tuple(sleeves.values()),
            rebalances=tuple(rebalances.values()),
            monthly_events=tuple(monthly_events),
        )
    )
