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
        "event.daily",
        "event.monthly",
        "event.quarterly",
        "asset_set.named",
        "selection.random_n_v1",
        "market.trailing_return",
        "selection.filter",
        "selection.rank",
        "selection.top_n",
        "selection.cooldown",
        "allocation.equal_weight",
        "targets.merge",
        "targets.fallback_asset",
        "portfolio.sleeve",
        "portfolio.compose",
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
    inputs: dict[tuple[str, str], list[str]] = {}
    for connection in strategy.graph.connections:
        inputs.setdefault(
            (connection.target.component_id, connection.target.port), []
        ).append(connection.source.component_id)
    implementations = {
        component.id: registry.get(component.primitive).implementation_id
        for component in strategy.graph.components
    }
    components = {component.id: component for component in strategy.graph.components}
    scheduled_sleeves = {
        entrypoint.target_component_id
        for entrypoint in strategy.entrypoints
        if implementations.get(entrypoint.target_component_id) == "portfolio.sleeve"
    }
    sleeve_outputs: dict[str, str] = {}
    user_state: list[strategy_ir.PerAssetState] = []
    cooldown_states: dict[str, str] = {}
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
            values = inputs[(component.id, port)]
        except KeyError as exc:
            raise StrategyDesugaringError(f"missing source for {component.id}.{port}") from exc
        if len(values) != 1:
            raise StrategyDesugaringError(f"expected one source for {component.id}.{port}")
        return values[0]

    def input_ids(component: Component, port: str) -> tuple[str, ...]:
        values = tuple(sorted(inputs.get((component.id, port), ())))
        if not values:
            raise StrategyDesugaringError(f"missing source for {component.id}.{port}")
        return values

    operations: list[strategy_ir.StrategyIROperation] = []
    bindings_json = canonical_parameter_bindings_json(strategy, parameter_bindings)
    for component in strategy.graph.components:
        implementation = implementations[component.id]
        provenance = strategy_ir.SourceProvenance(component_id=component.id)
        resolved = config(component)
        if implementation == "event.daily":
            operation = strategy_ir.DailyScheduleOp(
                id=component.id,
                provenance=provenance,
            )
        elif implementation == "event.monthly":
            operation = strategy_ir.MonthlyScheduleOp(
                id=component.id,
                day=int(resolved["day"]),
                provenance=provenance,
            )
        elif implementation == "event.quarterly":
            operation = strategy_ir.QuarterlyScheduleOp(
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
        elif implementation == "selection.filter":
            operation = strategy_ir.FilterOp(
                id=component.id,
                scores=input_id(component, "scores"),
                operator=typing.cast(typing.Literal["gt"], resolved["operator"]),
                threshold=Decimal(str(resolved["threshold"])),
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
        elif implementation == "selection.cooldown":
            state_id = f"{component.id}$last_exit"
            cooldown_states[component.id] = state_id
            user_state.append(
                strategy_ir.PerAssetState(
                    id=state_id,
                    value_type="trading_session_index",
                    initial=None,
                    provenance=provenance,
                )
            )
            operation = strategy_ir.ElapsedSessionsGateOp(
                id=component.id,
                candidates=input_id(component, "candidates"),
                last_exit_state=state_id,
                minimum_completed_sessions=int(resolved["duration"]),
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
        elif implementation == "targets.fallback_asset":
            primary_id = input_id(component, "primary")
            primary_component = components[primary_id]
            if implementations[primary_id] != "allocation.equal_weight":
                raise StrategyDesugaringError(
                    "fallback v0 primary must be equal-weight targets"
                )
            reference = str(resolved["fallback_asset_set_ref"])
            fallback_symbols = asset_sets[reference]
            if len(fallback_symbols) != 1:
                raise StrategyDesugaringError("fallback v0 requires exactly one asset")
            fallback_assets_id = f"{component.id}$assets"
            fallback_targets_id = f"{component.id}$targets"
            primary_total = Decimal(str(config(primary_component)["total"]))
            operations.extend(
                (
                    strategy_ir.AssetSetOp(
                        id=fallback_assets_id,
                        symbols=fallback_symbols,
                        provenance=provenance,
                    ),
                    strategy_ir.EqualWeightOp(
                        id=fallback_targets_id,
                        assets=fallback_assets_id,
                        total_weight=primary_total,
                        provenance=provenance,
                    ),
                )
            )
            operation = strategy_ir.FirstNonEmptyTargetsOp(
                id=component.id,
                primary=primary_id,
                fallback=fallback_targets_id,
                provenance=provenance,
            )
        elif implementation == "portfolio.sleeve":
            local_targets = input_id(component, "local_targets")
            if component.id in scheduled_sleeves:
                operations.append(
                    strategy_ir.RetainTargetsOp(
                        id=component.id,
                        targets=local_targets,
                        provenance=provenance,
                    )
                )
                output_id = f"{component.id}$scaled"
                sleeve_outputs[component.id] = output_id
                operation = strategy_ir.ScaleTargetsOp(
                    id=output_id,
                    targets=component.id,
                    factor=Decimal(str(resolved["allocation"])),
                    provenance=provenance,
                )
            else:
                operation = strategy_ir.ScaleTargetsOp(
                    id=component.id,
                    targets=local_targets,
                    factor=Decimal(str(resolved["allocation"])),
                    provenance=provenance,
                )
        elif implementation == "portfolio.compose":
            sleeve_ids = tuple(
                sleeve_outputs.get(item, item)
                for item in input_ids(component, "sleeves")
            )
            if len(sleeve_ids) != 2:
                raise StrategyDesugaringError("portfolio v0 requires exactly two sleeves")
            operation = strategy_ir.MergeTargetsOp(
                id=component.id,
                left=sleeve_ids[0],
                right=sleeve_ids[1],
                provenance=provenance,
            )
        elif implementation == "effect.rebalance":
            targets = input_id(component, "targets")
            matching_cooldowns = [
                cooldown_id
                for cooldown_id in cooldown_states
                if _source_depends_on(targets, cooldown_id, inputs)
            ]
            if len(matching_cooldowns) > 1:
                raise StrategyDesugaringError("cooldown v0 supports one stateful gate")
            if matching_cooldowns:
                cooldown_id = matching_cooldowns[0]
                observed_targets = f"{cooldown_id}$observe_exits"
                operations.append(
                    strategy_ir.ObserveTargetExitsOp(
                        id=observed_targets,
                        targets=targets,
                        last_exit_state=cooldown_states[cooldown_id],
                        provenance=strategy_ir.SourceProvenance(
                            component_id=cooldown_id
                        ),
                    )
                )
                targets = observed_targets
            operation = strategy_ir.RebalanceOp(
                id=component.id,
                targets=targets,
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
        user_state=tuple(user_state),
    )


def _source_depends_on(
    component_id: str,
    ancestor_id: str,
    inputs: dict[tuple[str, str], list[str]],
) -> bool:
    if component_id == ancestor_id:
        return True
    upstream = {
        source
        for (target, _), sources in inputs.items()
        if target == component_id
        for source in sources
    }
    return any(_source_depends_on(source, ancestor_id, inputs) for source in upstream)
