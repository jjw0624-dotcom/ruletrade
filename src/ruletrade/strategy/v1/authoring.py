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


class TransformToGrowthDefensiveOperation(FrozenModel):
    kind: Literal["transform_to_growth_defensive"] = "transform_to_growth_defensive"
    target_component_id: Identifier
    growth_allocation: Annotated[Decimal, Field(gt=0, lt=1)]
    defensive_assets: Annotated[tuple[Symbol, ...], Field(min_length=1)]


StructuralAuthoringOperation = Annotated[
    RenameGroupOperation
    | AddQualificationConditionOperation
    | RemoveQualificationConditionOperation
    | TransformToChooseAssetsOperation
    | AddFallbackSelectionOperation
    | TransformToGrowthDefensiveOperation,
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
    growth_defensive_targets: tuple[Identifier, ...] = ()
    create_choose_pipeline: bool
    add_fallback_selection: bool
    transform_to_growth_defensive: bool


def _component(strategy: CanonicalStrategyV1, component_id: str) -> Component:
    found = next((item for item in strategy.graph.components if item.id == component_id), None)
    if found is None:
        raise StructuralAuthoringError(
            "component_not_found",
            f"graph.components[{component_id}]",
            "The referenced strategy object was not found.",
        )
    return found


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


def _rename(
    strategy: CanonicalStrategyV1, operation: RenameGroupOperation
) -> CanonicalStrategyV1:
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
                replacement if item.id == group.id else item
                for item in strategy.graph.components
            )
        }
    )
    return strategy.model_copy(update={"graph": graph})


def _qualification_source(
    strategy: CanonicalStrategyV1, rank_id: str
) -> Connection:
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
        if item.source.component_id == condition.id
        or item.target.component_id == condition.id
    )
    if (
        condition.primitive != "filter@1"
        or len(inbound) != 1
        or len(outbound) != 1
        or len(referenced) != 2
    ):
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
            "components": tuple(
                item
                for item in strategy.graph.components
                if item.id != condition.id
            ),
            "connections": tuple(connections),
        }
    )
    return strategy.model_copy(update={"graph": graph})


def _connections_to(
    strategy: CanonicalStrategyV1, component_id: str, port: str
) -> tuple[Connection, ...]:
    return tuple(
        item
        for item in strategy.graph.connections
        if item.target.component_id == component_id and item.target.port == port
    )


def _connections_from(
    strategy: CanonicalStrategyV1, component_id: str, port: str
) -> tuple[Connection, ...]:
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
    asset_set = next(
        item for item in strategy.definitions.asset_sets if item.id == asset_set_ref
    )
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
    graph = strategy.graph.model_copy(
        update={"components": components, "connections": tuple(connections)}
    )
    return strategy.model_copy(update={"graph": graph})


def _filtered_selection_source(
    strategy: CanonicalStrategyV1, weight_component_id: str
) -> Connection:
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
            "unsupported_shape_transformation", f"graph.components[{rank.id}]", "Fallback requires a ranked selection."
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


def _simple_portfolio_output(
    strategy: CanonicalStrategyV1, target_component_id: str
) -> Connection:
    target = _component(strategy, target_component_id)
    outbound = _connections_from(strategy, target.id, "targets")
    if (
        target.primitive not in {"equal_weight@1", "fallback@1"}
        or len(outbound) != 1
        or _component(strategy, outbound[0].target.component_id).primitive != "rebalance@1"
        or outbound[0].target.port != "targets"
        or any(
            item.primitive in {"portfolio@1", "portfolio_sleeve@1"}
            for item in strategy.graph.components
        )
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
    normalized_defensive_assets = tuple(
        symbol.strip().upper() for symbol in operation.defensive_assets
    )
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
    graph = strategy.graph.model_copy(
        update={"components": components, "connections": tuple(connections)}
    )
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
    else:
        candidate = _transform_to_growth_defensive(strategy, operation)
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
    growth_defensive_targets: list[str] = []
    for item in strategy.graph.components:
        if item.primitive == "rank@1":
            try:
                _qualification_source(strategy, item.id)
            except StructuralAuthoringError:
                pass
            else:
                add_targets.append(item.id)
        elif item.primitive == "filter@1":
            try:
                apply_structural_operation(
                    strategy,
                    RemoveQualificationConditionOperation(
                        condition_component_id=item.id
                    ),
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
    return StructuralAuthoringCapabilities(
        groups=groups,
        qualification_add_targets=tuple(add_targets),
        qualification_remove_targets=tuple(remove_targets),
        rename_group=bool(groups),
        add_qualification_condition=bool(add_targets),
        remove_qualification_condition=bool(remove_targets),
        choose_pipeline_targets=tuple(choose_targets),
        fallback_add_targets=tuple(fallback_targets),
        growth_defensive_targets=tuple(growth_defensive_targets),
        create_choose_pipeline=bool(choose_targets),
        add_fallback_selection=bool(fallback_targets),
        transform_to_growth_defensive=bool(growth_defensive_targets),
    )
