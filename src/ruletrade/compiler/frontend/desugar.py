from __future__ import annotations

import typing
from collections.abc import Mapping
from decimal import Decimal

from ruletrade.hashing import strategy_hash
from ruletrade.ir.strategy import (
    AssetSetOp,
    EqualWeightOp,
    IREntrypoint,
    MergeTargetsOp,
    MonthlyScheduleOp,
    RandomNOp,
    RebalanceOp,
    SourceProvenance,
    StrategyIR,
    StrategyIROperation,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1, Component
from ruletrade.strategy.v1.randomness import canonical_parameter_bindings_json
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry


SUPPORTED_SOURCE_IMPLEMENTATIONS = frozenset(
    {
        "event.monthly",
        "asset_set.named",
        "selection.random_n_v1",
        "allocation.equal_weight",
        "targets.merge",
        "effect.rebalance",
    }
)


class StrategyDesugaringError(ValueError):
    pass


def desugar_strategy(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
    *,
    parameter_bindings: Mapping[str, object] | None = None,
) -> StrategyIR:
    """Lower the validated Strategy Model into the small Strategy IR kernel."""

    asset_sets = {definition.id: tuple(definition.assets) for definition in strategy.definitions.asset_sets}
    inputs = {
        (connection.target.component_id, connection.target.port): connection.source.component_id
        for connection in strategy.graph.connections
    }
    implementations = {
        component.id: registry.get(component.primitive).implementation_id
        for component in strategy.graph.components
    }
    unsupported = sorted(set(implementations.values()) - SUPPORTED_SOURCE_IMPLEMENTATIONS)
    if unsupported:
        raise StrategyDesugaringError(
            f"unsupported Strategy IR v0 primitive implementations: {', '.join(unsupported)}"
        )
    if strategy.definitions.state:
        raise StrategyDesugaringError("Strategy IR v0 does not support state definitions")

    def config(component: Component) -> dict[str, object]:
        return registry.resolve_config(component.primitive, component.config)

    def input_id(component: Component, port: str) -> str:
        try:
            return inputs[(component.id, port)]
        except KeyError as exc:
            raise StrategyDesugaringError(f"missing source for {component.id}.{port}") from exc

    operations: list[StrategyIROperation] = []
    bindings_json = canonical_parameter_bindings_json(strategy, parameter_bindings)
    for component in strategy.graph.components:
        implementation = implementations[component.id]
        provenance = SourceProvenance(component_id=component.id)
        resolved = config(component)
        if implementation == "event.monthly":
            operation = MonthlyScheduleOp(
                id=component.id,
                day=int(resolved["day"]),
                provenance=provenance,
            )
        elif implementation == "asset_set.named":
            operation = AssetSetOp(
                id=component.id,
                symbols=asset_sets[str(resolved["asset_set_ref"])],
                provenance=provenance,
            )
        elif implementation == "selection.random_n_v1":
            operation = RandomNOp(
                id=component.id,
                assets=input_id(component, "assets"),
                count=int(resolved["count"]),
                resample=typing.cast(
                    typing.Literal["once", "per_event"],
                    str(resolved["resample"]),
                ),
                parameter_bindings_json=bindings_json,
                provenance=provenance,
            )
        elif implementation == "allocation.equal_weight":
            operation = EqualWeightOp(
                id=component.id,
                assets=input_id(component, "assets"),
                total_weight=Decimal(str(resolved["total"])),
                provenance=provenance,
            )
        elif implementation == "targets.merge":
            operation = MergeTargetsOp(
                id=component.id,
                left=input_id(component, "left"),
                right=input_id(component, "right"),
                provenance=provenance,
            )
        elif implementation == "effect.rebalance":
            operation = RebalanceOp(
                id=component.id,
                targets=input_id(component, "targets"),
                provenance=provenance,
            )
        else:  # guarded by SUPPORTED_SOURCE_IMPLEMENTATIONS
            raise StrategyDesugaringError(f"unsupported source operation: {implementation}")
        operations.append(operation)

    return StrategyIR(
        strategy_identity=strategy_hash(strategy),
        operations=tuple(operations),
        entrypoints=tuple(
            IREntrypoint(event=item.event_component_id, target=item.target_component_id)
            for item in strategy.entrypoints
        ),
    )
