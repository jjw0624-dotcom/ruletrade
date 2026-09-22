from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field

from ruletrade.strategy.v1.models import (
    AssetSetDefinition,
    CanonicalStrategyV1,
    Component,
    Connection,
    FrozenModel,
    Identifier,
    PortReference,
    Symbol,
)
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveCategory
from ruletrade.strategy.v1.validation import StrategySemanticError, validate_strategy_v1


class StructuralAuthoringError(ValueError):
    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(message)
        self.code, self.path = code, path


class RenameGroupOperation(FrozenModel):
    kind: Literal["rename_group"] = "rename_group"
    group_component_id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=100)]


class AddQualificationConditionOperation(FrozenModel):
    kind: Literal["add_qualification_condition"] = "add_qualification_condition"
    rank_component_id: Identifier
    threshold: Decimal = Decimal(0)


class RemoveQualificationConditionOperation(FrozenModel):
    kind: Literal["remove_qualification_condition"] = "remove_qualification_condition"
    condition_component_id: Identifier


class TransformToChooseAssetsOperation(FrozenModel):
    kind: Literal["transform_to_choose_assets"] = "transform_to_choose_assets"
    weight_component_id: Identifier
    lookback_observations: Annotated[int, Field(ge=1)]
    count: Annotated[int, Field(ge=1)]


class AddFallbackSelectionOperation(FrozenModel):
    kind: Literal["add_fallback_selection"] = "add_fallback_selection"
    weight_component_id: Identifier
    fallback_asset: Symbol


class RemoveFallbackSelectionOperation(FrozenModel):
    kind: Literal["remove_fallback_selection"] = "remove_fallback_selection"
    fallback_component_id: Identifier


class AddCooldownOperation(FrozenModel):
    kind: Literal["add_cooldown_to_selection"] = "add_cooldown_to_selection"
    selection_component_id: Identifier
    duration: Annotated[int, Field(ge=1)]


class RemoveCooldownOperation(FrozenModel):
    kind: Literal["remove_cooldown_from_selection"] = "remove_cooldown_from_selection"
    cooldown_component_id: Identifier


class TransformToGrowthDefensiveOperation(FrozenModel):
    kind: Literal["transform_to_growth_defensive"] = "transform_to_growth_defensive"
    target_component_id: Identifier
    growth_allocation: Annotated[Decimal, Field(gt=0, lt=1)]
    defensive_assets: Annotated[tuple[Symbol, ...], Field(min_length=1)]


class UpdateAssetSetOperation(FrozenModel):
    kind: Literal["update_asset_set"] = "update_asset_set"
    asset_set_id: Identifier
    assets: Annotated[tuple[Symbol, ...], Field(min_length=1)]


class UpdateLookbackOperation(FrozenModel):
    kind: Literal["update_lookback"] = "update_lookback"
    component_id: Identifier
    lookback_bars: Annotated[int, Field(ge=1)]


class UpdateQualificationThresholdOperation(FrozenModel):
    kind: Literal["update_qualification_threshold"] = "update_qualification_threshold"
    component_id: Identifier
    threshold: Decimal


class UpdateSelectionCountOperation(FrozenModel):
    kind: Literal["update_selection_count"] = "update_selection_count"
    component_id: Identifier
    count: Annotated[int, Field(ge=1)]


class UpdateSelectionResampleOperation(FrozenModel):
    kind: Literal["update_selection_resample"] = "update_selection_resample"
    component_id: Identifier
    resample: Literal["once", "per_event"]


class SleeveAllocationInput(FrozenModel):
    component_id: Identifier
    allocation: Annotated[Decimal, Field(gt=0, le=1)]


class UpdateSleeveAllocationsOperation(FrozenModel):
    kind: Literal["update_sleeve_allocations"] = "update_sleeve_allocations"
    allocations: Annotated[tuple[SleeveAllocationInput, ...], Field(min_length=2, max_length=2)]


class UpdateScheduleOperation(FrozenModel):
    kind: Literal["update_schedule"] = "update_schedule"
    component_id: Identifier
    cadence: Literal["daily", "monthly", "quarterly"]
    day: Literal[1] | None = None


class UpdateCooldownDurationOperation(FrozenModel):
    kind: Literal["update_cooldown_duration"] = "update_cooldown_duration"
    component_id: Identifier
    duration: Annotated[int, Field(ge=1)]


class UpdateFallbackAssetSetOperation(FrozenModel):
    kind: Literal["update_fallback_asset_set"] = "update_fallback_asset_set"
    component_id: Identifier
    asset_set_id: Identifier


StructuralAuthoringOperation = Annotated[
    RenameGroupOperation
    | AddQualificationConditionOperation
    | RemoveQualificationConditionOperation
    | TransformToChooseAssetsOperation
    | AddFallbackSelectionOperation
    | RemoveFallbackSelectionOperation
    | AddCooldownOperation
    | RemoveCooldownOperation
    | TransformToGrowthDefensiveOperation
    | UpdateAssetSetOperation
    | UpdateLookbackOperation
    | UpdateQualificationThresholdOperation
    | UpdateSelectionCountOperation
    | UpdateSelectionResampleOperation
    | UpdateSleeveAllocationsOperation
    | UpdateScheduleOperation
    | UpdateCooldownDurationOperation
    | UpdateFallbackAssetSetOperation,
    Field(discriminator="kind"),
]


class ApplyStructuralAuthoringRequest(FrozenModel):
    strategy: CanonicalStrategyV1
    operation: StructuralAuthoringOperation


class ApplyStructuralAuthoringResponse(FrozenModel):
    strategy: CanonicalStrategyV1


class NamedCapability(FrozenModel):
    component_id: Identifier
    name: str


class AssetSetCapability(FrozenModel):
    asset_set_id: Identifier
    assets: tuple[Symbol, ...]


class IntegerCapability(FrozenModel):
    component_id: Identifier
    value: int
    minimum: int
    maximum: int | None = None


class DecimalCapability(FrozenModel):
    component_id: Identifier
    value: Decimal


class ChoiceCapability(FrozenModel):
    component_id: Identifier
    value: str
    choices: tuple[str, ...]


class AllocationCapability(FrozenModel):
    component_id: Identifier
    name: str
    allocation: Decimal


class SleeveAllocationCapability(FrozenModel):
    portfolio_component_id: Identifier
    sleeves: tuple[AllocationCapability, ...]


class ScheduleChoice(FrozenModel):
    cadence: Literal["daily", "monthly", "quarterly"]
    requires_day: bool
    default_day: int | None = None


class ScheduleCapability(FrozenModel):
    component_id: Identifier
    cadence: Literal["daily", "monthly", "quarterly"]
    day: int | None = None
    choices: tuple[ScheduleChoice, ...]


class FallbackAssetSetCapability(FrozenModel):
    component_id: Identifier
    asset_set_id: Identifier
    choices: tuple[Identifier, ...]


class StructuralAuthoringCapabilities(FrozenModel):
    groups: tuple[NamedCapability, ...]
    qualification_add_targets: tuple[Identifier, ...]
    qualification_remove_targets: tuple[Identifier, ...]
    add_group: Literal[False] = False
    remove_group: Literal[False] = False
    rename_group: bool
    add_qualification_condition: bool
    remove_qualification_condition: bool
    multiple_qualification_conditions: Literal[False] = False
    choose_pipeline_targets: tuple[Identifier, ...] = ()
    fallback_add_targets: tuple[Identifier, ...] = ()
    fallback_remove_targets: tuple[Identifier, ...] = ()
    cooldown_add_targets: tuple[Identifier, ...] = ()
    cooldown_remove_targets: tuple[Identifier, ...] = ()
    growth_defensive_targets: tuple[Identifier, ...] = ()
    create_choose_pipeline: bool
    add_fallback_selection: bool
    remove_fallback_selection: bool
    transform_to_growth_defensive: bool
    asset_set_targets: tuple[AssetSetCapability, ...] = ()
    lookback_targets: tuple[IntegerCapability, ...] = ()
    qualification_threshold_targets: tuple[DecimalCapability, ...] = ()
    selection_count_targets: tuple[IntegerCapability, ...] = ()
    selection_resample_targets: tuple[ChoiceCapability, ...] = ()
    sleeve_allocation_targets: tuple[SleeveAllocationCapability, ...] = ()
    schedule_targets: tuple[ScheduleCapability, ...] = ()
    cooldown_duration_targets: tuple[IntegerCapability, ...] = ()
    fallback_asset_set_targets: tuple[FallbackAssetSetCapability, ...] = ()


def _component(strategy: CanonicalStrategyV1, component_id: str) -> Component:
    found = next((item for item in strategy.graph.components if item.id == component_id), None)
    if found is None:
        raise StructuralAuthoringError(
            "component_not_found",
            f"graph.components[{component_id}]",
            "The referenced strategy object was not found.",
        )
    return found


def _replace_component(strategy: CanonicalStrategyV1, component: Component) -> CanonicalStrategyV1:
    graph = strategy.graph.model_copy(
        update={
            "components": tuple(
                component if item.id == component.id else item for item in strategy.graph.components
            )
        }
    )
    return strategy.model_copy(update={"graph": graph})


def _require_primitive(
    strategy: CanonicalStrategyV1,
    component_id: str,
    primitives: set[str],
    operation: str,
) -> Component:
    component = _component(strategy, component_id)
    if component.primitive not in primitives:
        raise StructuralAuthoringError(
            "unsupported_target",
            f"graph.components[{component.id}]",
            f"{operation} is not available for this strategy object.",
        )
    return component


def _update_config(
    strategy: CanonicalStrategyV1,
    component: Component,
    field: str,
    value: object,
) -> CanonicalStrategyV1:
    return _replace_component(
        strategy,
        component.model_copy(update={"config": {**component.config, field: value}}),
    )


def _incoming_component_ids(strategy: CanonicalStrategyV1, component_id: str) -> tuple[str, ...]:
    return tuple(
        connection.source.component_id
        for connection in strategy.graph.connections
        if connection.target.component_id == component_id
    )


def _upstream_asset_set_size(strategy: CanonicalStrategyV1, component_id: str) -> int | None:
    components = {item.id: item for item in strategy.graph.components}
    definitions = {item.id: item for item in strategy.definitions.asset_sets}
    pending = list(_incoming_component_ids(strategy, component_id))
    seen: set[str] = set()
    sizes: set[int] = set()
    while pending:
        current_id = pending.pop()
        if current_id in seen:
            continue
        seen.add(current_id)
        current = components.get(current_id)
        if current is None:
            continue
        if current.primitive == "asset_set@1":
            reference = current.config.get("asset_set_ref")
            definition = definitions.get(str(reference))
            if definition is not None:
                sizes.add(len(definition.assets))
            continue
        pending.extend(_incoming_component_ids(strategy, current_id))
    return next(iter(sizes)) if len(sizes) == 1 else None


def _update_asset_set(
    strategy: CanonicalStrategyV1, operation: UpdateAssetSetOperation
) -> CanonicalStrategyV1:
    definition = next(
        (item for item in strategy.definitions.asset_sets if item.id == operation.asset_set_id),
        None,
    )
    referenced = any(
        item.primitive == "asset_set@1" and item.config.get("asset_set_ref") == operation.asset_set_id
        for item in strategy.graph.components
    )
    if definition is None or not referenced:
        raise StructuralAuthoringError(
            "unsupported_target",
            f"definitions.asset_sets[{operation.asset_set_id}]",
            "That asset universe is not editable here.",
        )
    normalized = tuple(symbol.upper() for symbol in operation.assets)
    if len(set(normalized)) != len(normalized):
        raise StructuralAuthoringError(
            "invalid_input",
            f"definitions.asset_sets[{definition.id}].assets",
            "Ticker symbols must be unique.",
        )
    replacement = definition.model_copy(update={"assets": list(normalized)})
    definitions = strategy.definitions.model_copy(
        update={
            "asset_sets": tuple(
                replacement if item.id == definition.id else item for item in strategy.definitions.asset_sets
            )
        }
    )
    return strategy.model_copy(update={"definitions": definitions})


def _update_selection_count(
    strategy: CanonicalStrategyV1, operation: UpdateSelectionCountOperation
) -> CanonicalStrategyV1:
    component = _require_primitive(
        strategy,
        operation.component_id,
        {"top_n@1", "random_select@1"},
        "Selection count editing",
    )
    maximum = _upstream_asset_set_size(strategy, component.id)
    if maximum is not None and operation.count > maximum:
        raise StructuralAuthoringError(
            "selection_count_exceeds_assets",
            f"graph.components[{component.id}].config.count",
            "Choose cannot be greater than the number of available assets.",
        )
    return _update_config(strategy, component, "count", operation.count)


def _update_allocations(
    strategy: CanonicalStrategyV1, operation: UpdateSleeveAllocationsOperation
) -> CanonicalStrategyV1:
    ids = tuple(item.component_id for item in operation.allocations)
    if len(set(ids)) != 2:
        raise StructuralAuthoringError(
            "invalid_input", "portfolio.allocations", "Exactly two portfolio groups are required."
        )
    portfolio_sleeves = {
        connection.source.component_id
        for connection in strategy.graph.connections
        if connection.target.port == "sleeves"
        and _component(strategy, connection.target.component_id).primitive == "portfolio@1"
    }
    if set(ids) != portfolio_sleeves or len(portfolio_sleeves) != 2:
        raise StructuralAuthoringError(
            "unsupported_target",
            "portfolio.allocations",
            "Those portfolio groups cannot be allocated together.",
        )
    if sum((item.allocation for item in operation.allocations), Decimal(0)) != Decimal(1):
        raise StructuralAuthoringError(
            "invalid_input", "portfolio.allocations", "Portfolio allocations must total 100%."
        )
    updates = {item.component_id: item.allocation for item in operation.allocations}
    components = tuple(
        item.model_copy(update={"config": {**item.config, "allocation": updates[item.id]}})
        if item.id in updates
        else item
        for item in strategy.graph.components
    )
    return strategy.model_copy(update={"graph": strategy.graph.model_copy(update={"components": components})})


def _update_schedule(
    strategy: CanonicalStrategyV1, operation: UpdateScheduleOperation
) -> CanonicalStrategyV1:
    component = _component(strategy, operation.component_id)
    try:
        current = BUILTIN_REGISTRY.get(component.primitive)
    except KeyError as exc:
        raise StructuralAuthoringError(
            "unsupported_target", f"graph.components[{component.id}]", "That schedule is unavailable."
        ) from exc
    if current.category != PrimitiveCategory.EVENT:
        raise StructuralAuthoringError(
            "unsupported_target", f"graph.components[{component.id}]", "That object is not a schedule."
        )
    primitive = f"{operation.cadence}@1"
    config: dict[str, object] = {}
    if operation.cadence in {"monthly", "quarterly"}:
        config["day"] = operation.day if operation.day is not None else 1
    replacement = component.model_copy(update={"primitive": primitive, "config": config})
    return _replace_component(strategy, replacement)


def _validate_authoring_invariants(strategy: CanonicalStrategyV1) -> None:
    for component in strategy.graph.components:
        if component.primitive not in {"top_n@1", "random_select@1"}:
            continue
        maximum = _upstream_asset_set_size(strategy, component.id)
        if maximum is not None and int(component.config["count"]) > maximum:
            raise StructuralAuthoringError(
                "selection_count_exceeds_assets",
                f"graph.components[{component.id}].config.count",
                "Choose cannot be greater than the number of available assets.",
            )


def _to(strategy: CanonicalStrategyV1, component_id: str) -> tuple[Connection, ...]:
    return tuple(
        item
        for item in strategy.graph.connections
        if item.target.component_id == component_id and item.target.port == "scores"
    )


def _from(strategy: CanonicalStrategyV1, component_id: str) -> tuple[Connection, ...]:
    return tuple(
        item
        for item in strategy.graph.connections
        if item.source.component_id == component_id and item.source.port == "scores"
    )


def _rename(strategy: CanonicalStrategyV1, operation: RenameGroupOperation) -> CanonicalStrategyV1:
    group = _component(strategy, operation.group_component_id)
    if group.primitive != "portfolio_sleeve@1":
        raise StructuralAuthoringError(
            "unsupported_group",
            f"graph.components[{group.id}]",
            "Only portfolio groups can be renamed.",
        )
    name = operation.name.strip()
    if not name:
        raise StructuralAuthoringError(
            "invalid_group_name",
            f"graph.components[{group.id}].config.name",
            "Group name must not be empty.",
        )
    if any(
        item.id != group.id
        and item.primitive == "portfolio_sleeve@1"
        and str(item.config.get("name", "")).strip().casefold() == name.casefold()
        for item in strategy.graph.components
    ):
        raise StructuralAuthoringError(
            "duplicate_group_name",
            f"graph.components[{group.id}].config.name",
            "Group names must be unique.",
        )
    replacement = group.model_copy(update={"config": {**group.config, "name": name}})
    graph = strategy.graph.model_copy(
        update={
            "components": tuple(
                replacement if item.id == group.id else item for item in strategy.graph.components
            )
        }
    )
    return strategy.model_copy(update={"graph": graph})


def _qualification_source(strategy: CanonicalStrategyV1, rank_id: str) -> Connection:
    rank = _component(strategy, rank_id)
    inbound = _to(strategy, rank.id)
    if rank.primitive != "rank@1" or len(inbound) != 1:
        raise StructuralAuthoringError(
            "unsupported_qualification_structure",
            f"graph.components[{rank.id}]",
            "The selection is not a supported ranked return pipeline.",
        )
    source = _component(strategy, inbound[0].source.component_id)
    if source.primitive == "filter@1":
        raise StructuralAuthoringError(
            "qualification_condition_exists",
            f"graph.components[{source.id}]",
            "This selection already has a qualification condition.",
        )
    if source.primitive != "trailing_return@1" or inbound[0].source.port != "scores":
        raise StructuralAuthoringError(
            "unsupported_qualification_structure",
            f"graph.components[{rank.id}].inputs.scores",
            "Qualification v0 supports trailing-return selections only.",
        )
    return inbound[0]


def _add(
    strategy: CanonicalStrategyV1,
    operation: AddQualificationConditionOperation,
) -> CanonicalStrategyV1:
    old = _qualification_source(strategy, operation.rank_component_id)
    condition_id = f"{operation.rank_component_id}_qualification"
    if len(condition_id) > 100:
        raise StructuralAuthoringError(
            "generated_id_too_long",
            f"graph.components[{operation.rank_component_id}]",
            "The selection identity is too long.",
        )
    if any(item.id == condition_id for item in strategy.graph.components):
        raise StructuralAuthoringError(
            "component_id_conflict",
            f"graph.components[{condition_id}]",
            "The generated qualification identity is already in use.",
        )
    condition = Component(
        id=condition_id,
        primitive="filter@1",
        config={"operator": "gt", "threshold": operation.threshold},
    )
    before = Connection(
        source=old.source,
        target=PortReference(component_id=condition_id, port="scores"),
    )
    after = Connection(
        source=PortReference(component_id=condition_id, port="scores"),
        target=old.target,
    )
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        connections.extend((before, after) if item == old else (item,))
    graph = strategy.graph.model_copy(
        update={
            "components": (*strategy.graph.components, condition),
            "connections": tuple(connections),
        }
    )
    return strategy.model_copy(update={"graph": graph})


def _remove(
    strategy: CanonicalStrategyV1,
    operation: RemoveQualificationConditionOperation,
) -> CanonicalStrategyV1:
    condition = _component(strategy, operation.condition_component_id)
    inbound, outbound = _to(strategy, condition.id), _from(strategy, condition.id)
    referenced = tuple(
        item
        for item in strategy.graph.connections
        if item.source.component_id == condition.id or item.target.component_id == condition.id
    )
    if condition.primitive != "filter@1" or len(inbound) != 1 or len(outbound) != 1 or len(referenced) != 2:
        raise StructuralAuthoringError(
            "unsupported_qualification_structure",
            f"graph.components[{condition.id}]",
            "The condition is shared or is not in a supported selection pipeline.",
        )
    source = _component(strategy, inbound[0].source.component_id)
    target = _component(strategy, outbound[0].target.component_id)
    if (
        source.primitive != "trailing_return@1"
        or target.primitive != "rank@1"
        or inbound[0].source.port != "scores"
        or outbound[0].target.port != "scores"
    ):
        raise StructuralAuthoringError(
            "unsupported_qualification_structure",
            f"graph.components[{condition.id}]",
            "Qualification v0 requires trailing return -> filter -> rank.",
        )
    direct = Connection(source=inbound[0].source, target=outbound[0].target)
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        if item == inbound[0]:
            connections.append(direct)
        elif item != outbound[0]:
            connections.append(item)
    graph = strategy.graph.model_copy(
        update={
            "components": tuple(item for item in strategy.graph.components if item.id != condition.id),
            "connections": tuple(connections),
        }
    )
    return strategy.model_copy(update={"graph": graph})


def _connections_to(strategy: CanonicalStrategyV1, component_id: str, port: str) -> tuple[Connection, ...]:
    return tuple(
        item
        for item in strategy.graph.connections
        if item.target.component_id == component_id and item.target.port == port
    )


def _connections_from(strategy: CanonicalStrategyV1, component_id: str, port: str) -> tuple[Connection, ...]:
    return tuple(
        item
        for item in strategy.graph.connections
        if item.source.component_id == component_id and item.source.port == port
    )


def _generated_ids(strategy: CanonicalStrategyV1, *values: str) -> None:
    occupied = {item.id for item in strategy.graph.components}
    occupied.update(item.id for item in strategy.definitions.asset_sets)
    for value in values:
        if len(value) > 100:
            raise StructuralAuthoringError(
                "generated_id_too_long", "graph", "A generated strategy identity is too long."
            )
        if value in occupied:
            raise StructuralAuthoringError(
                "component_id_conflict",
                f"graph.components[{value}]",
                "A generated strategy identity is already in use.",
            )


def _simple_weight_source(
    strategy: CanonicalStrategyV1, weight_component_id: str
) -> tuple[Component, Connection, Connection]:
    weight = _component(strategy, weight_component_id)
    inbound = _connections_to(strategy, weight.id, "assets")
    outbound = _connections_from(strategy, weight.id, "targets")
    if weight.primitive != "equal_weight@1" or len(inbound) != 1 or len(outbound) != 1:
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{weight.id}]",
            "Choose creation requires one direct investment allocation.",
        )
    assets = _component(strategy, inbound[0].source.component_id)
    destination = _component(strategy, outbound[0].target.component_id)
    if (
        assets.primitive != "asset_set@1"
        or inbound[0].source.port != "assets"
        or destination.primitive != "rebalance@1"
        or outbound[0].target.port != "targets"
    ):
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{weight.id}]",
            "Choose creation supports a direct asset set to allocation to rebalance shape.",
        )
    return assets, inbound[0], outbound[0]


def _transform_to_choose(
    strategy: CanonicalStrategyV1, operation: TransformToChooseAssetsOperation
) -> CanonicalStrategyV1:
    assets, direct, _ = _simple_weight_source(strategy, operation.weight_component_id)
    asset_set_ref = str(assets.config["asset_set_ref"])
    asset_set = next(item for item in strategy.definitions.asset_sets if item.id == asset_set_ref)
    if operation.count > len(asset_set.assets):
        raise StructuralAuthoringError(
            "selection_count_exceeds_assets",
            f"graph.components[{operation.weight_component_id}]",
            "The number selected cannot exceed the available assets.",
        )
    prefix = operation.weight_component_id
    return_id, rank_id, top_id = (
        f"{prefix}_trailing_return",
        f"{prefix}_rank",
        f"{prefix}_top_n",
    )
    _generated_ids(strategy, return_id, rank_id, top_id)
    components = (
        *strategy.graph.components,
        Component(
            id=return_id,
            primitive="trailing_return@1",
            config={"lookback_bars": operation.lookback_observations},
        ),
        Component(
            id=rank_id,
            primitive="rank@1",
            config={"direction": "descending"},
        ),
        Component(id=top_id, primitive="top_n@1", config={"count": operation.count}),
    )
    replacement = (
        Connection(
            source=direct.source,
            target=PortReference(component_id=return_id, port="assets"),
        ),
        Connection(
            source=PortReference(component_id=return_id, port="scores"),
            target=PortReference(component_id=rank_id, port="scores"),
        ),
        Connection(
            source=PortReference(component_id=rank_id, port="ranked"),
            target=PortReference(component_id=top_id, port="ranked"),
        ),
        Connection(
            source=PortReference(component_id=top_id, port="selected"),
            target=direct.target,
        ),
    )
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        connections.extend(replacement if item == direct else (item,))
    graph = strategy.graph.model_copy(update={"components": components, "connections": tuple(connections)})
    return strategy.model_copy(update={"graph": graph})


def _filtered_selection_source(strategy: CanonicalStrategyV1, weight_component_id: str) -> Connection:
    weight = _component(strategy, weight_component_id)
    inbound = _connections_to(strategy, weight.id, "assets")
    outbound = _connections_from(strategy, weight.id, "targets")
    if weight.primitive != "equal_weight@1" or len(inbound) != 1 or len(outbound) != 1:
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{weight.id}]",
            "Fallback requires one filtered selection allocation.",
        )
    top = _component(strategy, inbound[0].source.component_id)
    rank_inputs = _connections_to(strategy, top.id, "ranked")
    if top.primitive != "top_n@1" or len(rank_inputs) != 1:
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{weight.id}]",
            "Fallback requires a supported Top N selection.",
        )
    rank = _component(strategy, rank_inputs[0].source.component_id)
    filter_inputs = _connections_to(strategy, rank.id, "scores")
    if rank.primitive != "rank@1" or len(filter_inputs) != 1:
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{rank.id}]",
            "Fallback requires a ranked selection.",
        )
    condition = _component(strategy, filter_inputs[0].source.component_id)
    destination = _component(strategy, outbound[0].target.component_id)
    if (
        condition.primitive != "filter@1"
        or destination.primitive != "rebalance@1"
        or outbound[0].target.port != "targets"
    ):
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{weight.id}]",
            "Fallback requires a filtered selection that directly rebalances.",
        )
    return outbound[0]


def _add_fallback(
    strategy: CanonicalStrategyV1, operation: AddFallbackSelectionOperation
) -> CanonicalStrategyV1:
    direct = _filtered_selection_source(strategy, operation.weight_component_id)
    definition_id = f"{operation.weight_component_id}_fallback_assets"
    fallback_id = f"{operation.weight_component_id}_fallback"
    _generated_ids(strategy, definition_id, fallback_id)
    definitions = strategy.definitions.model_copy(
        update={
            "asset_sets": (
                *strategy.definitions.asset_sets,
                AssetSetDefinition(id=definition_id, assets=[operation.fallback_asset]),
            )
        }
    )
    fallback = Component(
        id=fallback_id,
        primitive="fallback@1",
        config={"fallback_asset_set_ref": definition_id},
    )
    replacement = (
        Connection(
            source=direct.source,
            target=PortReference(component_id=fallback_id, port="primary"),
        ),
        Connection(
            source=PortReference(component_id=fallback_id, port="targets"),
            target=direct.target,
        ),
    )
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        connections.extend(replacement if item == direct else (item,))
    graph = strategy.graph.model_copy(
        update={
            "components": (*strategy.graph.components, fallback),
            "connections": tuple(connections),
        }
    )
    return strategy.model_copy(update={"definitions": definitions, "graph": graph})


def _remove_fallback(
    strategy: CanonicalStrategyV1, operation: RemoveFallbackSelectionOperation
) -> CanonicalStrategyV1:
    fallback = _component(strategy, operation.fallback_component_id)
    inbound = _connections_to(strategy, fallback.id, "primary")
    outbound = _connections_from(strategy, fallback.id, "targets")
    referenced = tuple(
        item
        for item in strategy.graph.connections
        if item.source.component_id == fallback.id or item.target.component_id == fallback.id
    )
    if fallback.primitive != "fallback@1" or len(inbound) != 1 or len(outbound) != 1 or len(referenced) != 2:
        raise StructuralAuthoringError(
            "unsupported_fallback_structure",
            f"graph.components[{fallback.id}]",
            "This fallback is shared or is not in a supported selection pipeline.",
        )
    primary = _component(strategy, inbound[0].source.component_id)
    destination = _component(strategy, outbound[0].target.component_id)
    if (
        primary.primitive != "equal_weight@1"
        or inbound[0].source.port != "targets"
        or (destination.primitive == "rebalance@1" and outbound[0].target.port != "targets")
        or (destination.primitive == "portfolio_sleeve@1" and outbound[0].target.port != "local_targets")
        or destination.primitive not in {"rebalance@1", "portfolio_sleeve@1"}
    ):
        raise StructuralAuthoringError(
            "unsupported_fallback_structure",
            f"graph.components[{fallback.id}]",
            "Fallback removal requires one owned selection allocation destination.",
        )
    definition_id = str(fallback.config.get("fallback_asset_set_ref", ""))
    if not definition_id or any(
        item.id != fallback.id and definition_id in item.config.values() for item in strategy.graph.components
    ):
        raise StructuralAuthoringError(
            "shared_fallback_assets",
            f"definitions.asset_sets[{definition_id}]",
            "This fallback asset set is shared and cannot be removed safely.",
        )
    direct = Connection(source=inbound[0].source, target=outbound[0].target)
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        if item == inbound[0]:
            connections.append(direct)
        elif item != outbound[0]:
            connections.append(item)
    graph = strategy.graph.model_copy(
        update={
            "components": tuple(item for item in strategy.graph.components if item.id != fallback.id),
            "connections": tuple(connections),
        }
    )
    definitions = strategy.definitions.model_copy(
        update={
            "asset_sets": tuple(item for item in strategy.definitions.asset_sets if item.id != definition_id)
        }
    )
    return strategy.model_copy(update={"definitions": definitions, "graph": graph})


def _cooldown_source(strategy: CanonicalStrategyV1, selection_id: str) -> Connection:
    selection = _component(strategy, selection_id)
    outbound = _connections_from(strategy, selection_id, "selected")
    if selection.primitive != "top_n@1" or len(outbound) != 1:
        raise StructuralAuthoringError(
            "unsupported_cooldown_structure", f"graph.components[{selection_id}]",
            "Cooldown requires a supported Top N selection.",
        )
    destination = _component(strategy, outbound[0].target.component_id)
    if destination.primitive != "equal_weight@1" or outbound[0].target.port != "assets":
        raise StructuralAuthoringError(
            "unsupported_cooldown_structure", f"graph.components[{selection_id}]",
            "Cooldown requires Top N to feed the allocation directly.",
        )
    allocation_outputs = _connections_from(strategy, destination.id, "targets")
    if len(allocation_outputs) != 1 or _component(strategy, allocation_outputs[0].target.component_id).primitive == "fallback@1":
        raise StructuralAuthoringError(
            "unsupported_cooldown_structure", f"graph.components[{selection_id}]",
            "Cooldown cannot be added to a fallback selection in the current supported shape.",
        )
    return outbound[0]


def _add_cooldown(strategy: CanonicalStrategyV1, operation: AddCooldownOperation) -> CanonicalStrategyV1:
    direct = _cooldown_source(strategy, operation.selection_component_id)
    cooldown_id = f"{operation.selection_component_id}_cooldown"
    _generated_ids(strategy, cooldown_id)
    cooldown = Component(
        id=cooldown_id, primitive="cooldown@1",
        config={"duration": operation.duration, "unit": "trading_days"},
    )
    before = Connection(
        source=direct.source,
        target=PortReference(component_id=cooldown_id, port="candidates"),
    )
    after = Connection(
        source=PortReference(component_id=cooldown_id, port="eligible"),
        target=direct.target,
    )
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        connections.extend((before, after) if item == direct else (item,))
    graph = strategy.graph.model_copy(update={
        "components": tuple(
            part for item in strategy.graph.components
            for part in ((cooldown, item) if item.id == direct.target.component_id else (item,))
        ), "connections": tuple(connections),
    })
    return strategy.model_copy(update={"graph": graph})


def _remove_cooldown(strategy: CanonicalStrategyV1, operation: RemoveCooldownOperation) -> CanonicalStrategyV1:
    cooldown = _component(strategy, operation.cooldown_component_id)
    inbound = _connections_to(strategy, cooldown.id, "candidates")
    outbound = _connections_from(strategy, cooldown.id, "eligible")
    referenced = tuple(item for item in strategy.graph.connections
                       if item.source.component_id == cooldown.id or item.target.component_id == cooldown.id)
    if cooldown.primitive != "cooldown@1" or len(inbound) != 1 or len(outbound) != 1 or len(referenced) != 2:
        raise StructuralAuthoringError(
            "unsupported_cooldown_structure", f"graph.components[{cooldown.id}]",
            "This cooldown is shared or is not in a supported selection pipeline.",
        )
    source = _component(strategy, inbound[0].source.component_id)
    destination = _component(strategy, outbound[0].target.component_id)
    if (source.primitive != "top_n@1" or inbound[0].source.port != "selected"
            or destination.primitive != "equal_weight@1" or outbound[0].target.port != "assets"):
        raise StructuralAuthoringError(
            "unsupported_cooldown_structure", f"graph.components[{cooldown.id}]",
            "Cooldown removal requires a direct Top N to allocation pipeline.",
        )
    direct = Connection(source=inbound[0].source, target=outbound[0].target)
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        if item == inbound[0]:
            connections.append(direct)
        elif item != outbound[0]:
            connections.append(item)
    graph = strategy.graph.model_copy(update={
        "components": tuple(item for item in strategy.graph.components if item.id != cooldown.id),
        "connections": tuple(connections),
    })
    return strategy.model_copy(update={"graph": graph})


def _simple_portfolio_output(strategy: CanonicalStrategyV1, target_component_id: str) -> Connection:
    target = _component(strategy, target_component_id)
    outbound = _connections_from(strategy, target.id, "targets")
    if (
        target.primitive not in {"equal_weight@1", "fallback@1"}
        or len(outbound) != 1
        or _component(strategy, outbound[0].target.component_id).primitive != "rebalance@1"
        or outbound[0].target.port != "targets"
        or any(item.primitive in {"portfolio@1", "portfolio_sleeve@1"} for item in strategy.graph.components)
    ):
        raise StructuralAuthoringError(
            "unsupported_shape_transformation",
            f"graph.components[{target.id}]",
            "Portfolio splitting requires one ungrouped strategy output.",
        )
    return outbound[0]


def _transform_to_growth_defensive(
    strategy: CanonicalStrategyV1,
    operation: TransformToGrowthDefensiveOperation,
) -> CanonicalStrategyV1:
    direct = _simple_portfolio_output(strategy, operation.target_component_id)
    normalized_defensive_assets = tuple(symbol.strip().upper() for symbol in operation.defensive_assets)
    if len(set(normalized_defensive_assets)) != len(normalized_defensive_assets):
        raise StructuralAuthoringError(
            "duplicate_asset",
            "operation.defensive_assets",
            "Defensive assets must be unique.",
        )
    prefix = operation.target_component_id
    defensive_definition_id = f"{prefix}_defensive_assets"
    growth_sleeve_id = f"{prefix}_growth_sleeve"
    defensive_assets_id = f"{prefix}_defensive_asset_set"
    defensive_weights_id = f"{prefix}_defensive_weights"
    defensive_sleeve_id = f"{prefix}_defensive_sleeve"
    portfolio_id = f"{prefix}_portfolio"
    _generated_ids(
        strategy,
        defensive_definition_id,
        growth_sleeve_id,
        defensive_assets_id,
        defensive_weights_id,
        defensive_sleeve_id,
        portfolio_id,
    )
    definitions = strategy.definitions.model_copy(
        update={
            "asset_sets": (
                *strategy.definitions.asset_sets,
                AssetSetDefinition(
                    id=defensive_definition_id,
                    assets=list(normalized_defensive_assets),
                ),
            )
        }
    )
    defensive_allocation = Decimal(1) - operation.growth_allocation
    components = (
        *strategy.graph.components,
        Component(
            id=growth_sleeve_id,
            primitive="portfolio_sleeve@1",
            config={"name": "Growth", "allocation": operation.growth_allocation},
        ),
        Component(
            id=defensive_assets_id,
            primitive="asset_set@1",
            config={"asset_set_ref": defensive_definition_id},
        ),
        Component(
            id=defensive_weights_id,
            primitive="equal_weight@1",
            config={"total": Decimal(1)},
        ),
        Component(
            id=defensive_sleeve_id,
            primitive="portfolio_sleeve@1",
            config={"name": "Defensive", "allocation": defensive_allocation},
        ),
        Component(
            id=portfolio_id,
            primitive="portfolio@1",
            config={"name": "Portfolio"},
        ),
    )
    replacement = (
        Connection(
            source=direct.source,
            target=PortReference(component_id=growth_sleeve_id, port="local_targets"),
        ),
        Connection(
            source=PortReference(component_id=defensive_assets_id, port="assets"),
            target=PortReference(component_id=defensive_weights_id, port="assets"),
        ),
        Connection(
            source=PortReference(component_id=defensive_weights_id, port="targets"),
            target=PortReference(component_id=defensive_sleeve_id, port="local_targets"),
        ),
        Connection(
            source=PortReference(component_id=growth_sleeve_id, port="contribution"),
            target=PortReference(component_id=portfolio_id, port="sleeves"),
        ),
        Connection(
            source=PortReference(component_id=defensive_sleeve_id, port="contribution"),
            target=PortReference(component_id=portfolio_id, port="sleeves"),
        ),
        Connection(
            source=PortReference(component_id=portfolio_id, port="targets"),
            target=direct.target,
        ),
    )
    connections: list[Connection] = []
    for item in strategy.graph.connections:
        connections.extend(replacement if item == direct else (item,))
    graph = strategy.graph.model_copy(update={"components": components, "connections": tuple(connections)})
    return strategy.model_copy(update={"definitions": definitions, "graph": graph})


def apply_structural_operation(
    strategy: CanonicalStrategyV1,
    operation: StructuralAuthoringOperation,
) -> CanonicalStrategyV1:
    if isinstance(operation, RenameGroupOperation):
        candidate = _rename(strategy, operation)
    elif isinstance(operation, AddQualificationConditionOperation):
        candidate = _add(strategy, operation)
    elif isinstance(operation, RemoveQualificationConditionOperation):
        candidate = _remove(strategy, operation)
    elif isinstance(operation, TransformToChooseAssetsOperation):
        candidate = _transform_to_choose(strategy, operation)
    elif isinstance(operation, AddFallbackSelectionOperation):
        candidate = _add_fallback(strategy, operation)
    elif isinstance(operation, RemoveFallbackSelectionOperation):
        candidate = _remove_fallback(strategy, operation)
    elif isinstance(operation, AddCooldownOperation):
        candidate = _add_cooldown(strategy, operation)
    elif isinstance(operation, RemoveCooldownOperation):
        candidate = _remove_cooldown(strategy, operation)
    elif isinstance(operation, TransformToGrowthDefensiveOperation):
        candidate = _transform_to_growth_defensive(strategy, operation)
    elif isinstance(operation, UpdateAssetSetOperation):
        candidate = _update_asset_set(strategy, operation)
    elif isinstance(operation, UpdateLookbackOperation):
        component = _require_primitive(
            strategy, operation.component_id, {"trailing_return@1"}, "Lookback editing"
        )
        candidate = _update_config(strategy, component, "lookback_bars", operation.lookback_bars)
    elif isinstance(operation, UpdateQualificationThresholdOperation):
        component = _require_primitive(strategy, operation.component_id, {"filter@1"}, "Threshold editing")
        candidate = _update_config(strategy, component, "threshold", operation.threshold)
    elif isinstance(operation, UpdateSelectionCountOperation):
        candidate = _update_selection_count(strategy, operation)
    elif isinstance(operation, UpdateSelectionResampleOperation):
        component = _require_primitive(
            strategy, operation.component_id, {"random_select@1"}, "Resample editing"
        )
        candidate = _update_config(strategy, component, "resample", operation.resample)
    elif isinstance(operation, UpdateSleeveAllocationsOperation):
        candidate = _update_allocations(strategy, operation)
    elif isinstance(operation, UpdateScheduleOperation):
        candidate = _update_schedule(strategy, operation)
    elif isinstance(operation, UpdateCooldownDurationOperation):
        component = _require_primitive(strategy, operation.component_id, {"cooldown@1"}, "Cooldown editing")
        candidate = _update_config(strategy, component, "duration", operation.duration)
    else:
        component = _require_primitive(
            strategy,
            operation.component_id,
            {"fallback@1"},
            "Fallback editing",
        )
        definition = next(
            (
                item
                for item in strategy.definitions.asset_sets
                if item.id == operation.asset_set_id and len(item.assets) == 1
            ),
            None,
        )
        if definition is None:
            raise StructuralAuthoringError(
                "invalid_input",
                f"definitions.asset_sets[{operation.asset_set_id}]",
                "Fallback must reference an existing single-asset set.",
            )
        candidate = _update_config(strategy, component, "fallback_asset_set_ref", definition.id)
    _validate_authoring_invariants(candidate)
    try:
        validate_strategy_v1(candidate)
    except StrategySemanticError as exc:
        issue = exc.issues[0]
        raise StructuralAuthoringError(
            "result_invalid",
            issue.path,
            f"The requested change would make the strategy invalid: {issue.message}",
        ) from exc
    return candidate


def structural_authoring_capabilities(
    strategy: CanonicalStrategyV1,
) -> StructuralAuthoringCapabilities:
    groups = tuple(
        NamedCapability(
            component_id=item.id,
            name=str(item.config.get("name", "")).strip(),
        )
        for item in strategy.graph.components
        if item.primitive == "portfolio_sleeve@1"
    )
    add_targets: list[str] = []
    remove_targets: list[str] = []
    choose_targets: list[str] = []
    fallback_targets: list[str] = []
    fallback_remove_targets: list[str] = []
    cooldown_add_targets: list[str] = []
    cooldown_remove_targets: list[str] = []
    growth_defensive_targets: list[str] = []
    asset_set_ids = {
        str(item.config.get("asset_set_ref"))
        for item in strategy.graph.components
        if item.primitive == "asset_set@1"
    }
    asset_set_targets = tuple(
        AssetSetCapability(asset_set_id=item.id, assets=tuple(item.assets))
        for item in strategy.definitions.asset_sets
        if item.id in asset_set_ids
    )
    lookback_targets: list[IntegerCapability] = []
    threshold_targets: list[DecimalCapability] = []
    selection_count_targets: list[IntegerCapability] = []
    resample_targets: list[ChoiceCapability] = []
    schedule_targets: list[ScheduleCapability] = []
    cooldown_targets: list[IntegerCapability] = []
    fallback_edit_targets: list[FallbackAssetSetCapability] = []
    singleton_asset_sets = tuple(item.id for item in strategy.definitions.asset_sets if len(item.assets) == 1)
    for item in strategy.graph.components:
        resolved = BUILTIN_REGISTRY.resolve_config(item.primitive, item.config)
        if item.primitive == "trailing_return@1":
            lookback_targets.append(
                IntegerCapability(
                    component_id=item.id,
                    value=int(resolved["lookback_bars"]),
                    minimum=1,
                )
            )
        elif item.primitive == "filter@1":
            threshold_targets.append(
                DecimalCapability(component_id=item.id, value=Decimal(str(resolved["threshold"])))
            )
        elif item.primitive in {"top_n@1", "random_select@1"}:
            selection_count_targets.append(
                IntegerCapability(
                    component_id=item.id,
                    value=int(resolved["count"]),
                    minimum=1,
                    maximum=_upstream_asset_set_size(strategy, item.id),
                )
            )
            if item.primitive == "random_select@1":
                resample_targets.append(
                    ChoiceCapability(
                        component_id=item.id,
                        value=str(resolved["resample"]),
                        choices=("once", "per_event"),
                    )
                )
        elif item.primitive in {"daily@1", "monthly@1", "quarterly@1"}:
            schedule_targets.append(
                ScheduleCapability(
                    component_id=item.id,
                    cadence=item.primitive.removesuffix("@1"),
                    day=int(resolved["day"]) if "day" in resolved else None,
                    choices=(
                        ScheduleChoice(cadence="daily", requires_day=False),
                        ScheduleChoice(cadence="monthly", requires_day=True, default_day=1),
                        ScheduleChoice(cadence="quarterly", requires_day=True, default_day=1),
                    ),
                )
            )
        elif item.primitive == "cooldown@1":
            cooldown_targets.append(
                IntegerCapability(
                    component_id=item.id,
                    value=int(resolved["duration"]),
                    minimum=1,
                )
            )
        elif item.primitive == "fallback@1":
            fallback_edit_targets.append(
                FallbackAssetSetCapability(
                    component_id=item.id,
                    asset_set_id=str(resolved["fallback_asset_set_ref"]),
                    choices=singleton_asset_sets,
                )
            )
        if item.primitive == "rank@1":
            try:
                _qualification_source(strategy, item.id)
            except StructuralAuthoringError:
                pass
            else:
                add_targets.append(item.id)
        elif item.primitive == "top_n@1":
            try:
                _cooldown_source(strategy, item.id)
            except StructuralAuthoringError:
                pass
            else:
                cooldown_add_targets.append(item.id)
        elif item.primitive == "cooldown@1":
            try:
                _remove_cooldown(strategy, RemoveCooldownOperation(cooldown_component_id=item.id))
            except StructuralAuthoringError:
                pass
            else:
                cooldown_remove_targets.append(item.id)
        elif item.primitive == "filter@1":
            try:
                apply_structural_operation(
                    strategy,
                    RemoveQualificationConditionOperation(condition_component_id=item.id),
                )
            except StructuralAuthoringError:
                pass
            else:
                remove_targets.append(item.id)
        if item.primitive == "equal_weight@1":
            try:
                _simple_weight_source(strategy, item.id)
            except StructuralAuthoringError:
                pass
            else:
                choose_targets.append(item.id)
            try:
                _filtered_selection_source(strategy, item.id)
            except StructuralAuthoringError:
                pass
            else:
                fallback_targets.append(item.id)
        if item.primitive in {"equal_weight@1", "fallback@1"}:
            try:
                _simple_portfolio_output(strategy, item.id)
            except StructuralAuthoringError:
                pass
            else:
                growth_defensive_targets.append(item.id)
        if item.primitive == "fallback@1":
            try:
                _remove_fallback(
                    strategy,
                    RemoveFallbackSelectionOperation(fallback_component_id=item.id),
                )
            except StructuralAuthoringError:
                pass
            else:
                fallback_remove_targets.append(item.id)
    allocation_targets: list[SleeveAllocationCapability] = []
    components = {item.id: item for item in strategy.graph.components}
    for portfolio in strategy.graph.components:
        if portfolio.primitive != "portfolio@1":
            continue
        sleeve_ids = tuple(
            connection.source.component_id
            for connection in strategy.graph.connections
            if connection.target.component_id == portfolio.id and connection.target.port == "sleeves"
        )
        sleeves = tuple(
            components[item]
            for item in sleeve_ids
            if item in components and components[item].primitive == "portfolio_sleeve@1"
        )
        if len(sleeves) == len(sleeve_ids) == 2:
            allocation_targets.append(
                SleeveAllocationCapability(
                    portfolio_component_id=portfolio.id,
                    sleeves=tuple(
                        AllocationCapability(
                            component_id=item.id,
                            name=str(item.config["name"]),
                            allocation=Decimal(str(item.config["allocation"])),
                        )
                        for item in sleeves
                    ),
                )
            )
    return StructuralAuthoringCapabilities(
        groups=groups,
        qualification_add_targets=tuple(add_targets),
        qualification_remove_targets=tuple(remove_targets),
        rename_group=bool(groups),
        add_qualification_condition=bool(add_targets),
        remove_qualification_condition=bool(remove_targets),
        choose_pipeline_targets=tuple(choose_targets),
        fallback_add_targets=tuple(fallback_targets),
        fallback_remove_targets=tuple(fallback_remove_targets),
        cooldown_add_targets=tuple(cooldown_add_targets),
        cooldown_remove_targets=tuple(cooldown_remove_targets),
        growth_defensive_targets=tuple(growth_defensive_targets),
        create_choose_pipeline=bool(choose_targets),
        add_fallback_selection=bool(fallback_targets),
        remove_fallback_selection=bool(fallback_remove_targets),
        transform_to_growth_defensive=bool(growth_defensive_targets),
        asset_set_targets=asset_set_targets,
        lookback_targets=tuple(lookback_targets),
        qualification_threshold_targets=tuple(threshold_targets),
        selection_count_targets=tuple(selection_count_targets),
        selection_resample_targets=tuple(resample_targets),
        sleeve_allocation_targets=tuple(allocation_targets),
        schedule_targets=tuple(schedule_targets),
        cooldown_duration_targets=tuple(cooldown_targets),
        fallback_asset_set_targets=tuple(fallback_edit_targets),
    )
