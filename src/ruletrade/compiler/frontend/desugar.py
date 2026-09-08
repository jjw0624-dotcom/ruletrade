from __future__ import annotations

import typing
from collections.abc import Mapping
from decimal import Decimal

from ruletrade.hashing import strategy_hash
from ruletrade.ir import strategy as strategy_ir
from ruletrade.strategy.v1.models import CanonicalStrategyV1, Component
from ruletrade.strategy.v1.randomness import canonical_parameter_bindings_json
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry

SUPPORTED_SOURCE_IMPLEMENTATIONS = frozenset(
    {
        "event.monthly",
        "asset_set.named",
        "selection.random_n_v1",
        "market.trailing_return",
        "selection.rank",
        "selection.top_n",
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
) -> strategy_ir.StrategyIR:
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

    operations: list[strategy_ir.StrategyIROperation] = []
    bindings_json = canonical_parameter_bindings_json(strategy, parameter_bindings)
    for component in strategy.graph.components:
        implementation = implementations[component.id]
        provenance = strategy_ir.SourceProvenance(component_id=component.id)
        resolved = config(component)
        if implementation == "event.monthly":
            operation = strategy_ir.MonthlyScheduleOp(
                id=component.id,
                day=int(resolved["day"]),
                provenance=provenance,
            )
        elif implementation == "asset_set.named":
            operation = strategy_ir.AssetSetOp(
                id=component.id,
                symbols=asset_sets[str(resolved["asset_set_ref"])],
                provenance=provenance,
            )
        elif implementation == "selection.random_n_v1":
            operation = strategy_ir.RandomNOp(
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
        elif implementation == "market.trailing_return":
            operation = strategy_ir.TrailingReturnOp(
                id=component.id,
                assets=input_id(component, "assets"),
                lookback_bars=int(resolved["lookback_bars"]),
                provenance=provenance,
            )
        elif implementation == "selection.rank":
            operation = strategy_ir.RankOp(
                id=component.id,
                scores=input_id(component, "scores"),
                direction=typing.cast(typing.Literal["descending"], resolved["direction"]),
                provenance=provenance,
            )
        elif implementation == "selection.top_n":
            operation = strategy_ir.TopNOp(
                id=component.id,
                ranked=input_id(component, "ranked"),
                count=int(resolved["count"]),
                provenance=provenance,
            )
        elif implementation == "allocation.equal_weight":
            operation = strategy_ir.EqualWeightOp(
                id=component.id,
                assets=input_id(component, "assets"),
                total_weight=Decimal(str(resolved["total"])),
                provenance=provenance,
            )
        elif implementation == "targets.merge":
            operation = strategy_ir.MergeTargetsOp(
                id=component.id,
                left=input_id(component, "left"),
                right=input_id(component, "right"),
                provenance=provenance,
            )
        elif implementation == "effect.rebalance":
            operation = strategy_ir.RebalanceOp(
                id=component.id,
                targets=input_id(component, "targets"),
                provenance=provenance,
            )
        else:  # guarded by SUPPORTED_SOURCE_IMPLEMENTATIONS
            raise StrategyDesugaringError(f"unsupported source operation: {implementation}")
        operations.append(operation)

    return strategy_ir.StrategyIR(
        strategy_identity=strategy_hash(strategy),
        operations=tuple(operations),
        entrypoints=tuple(
            strategy_ir.IREntrypoint(
                event=item.event_component_id,
                target=item.target_component_id,
            )
            for item in strategy.entrypoints
        ),
    )
