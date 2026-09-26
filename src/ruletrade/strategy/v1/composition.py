from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

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


class CompositionError(ValueError):
    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(message)
        self.code, self.path = code, path


class ComponentAddress(FrozenModel):
    component_id: Identifier | None = None
    created_ref: Identifier | None = None

    @model_validator(mode="after")
    def exactly_one_address(self) -> ComponentAddress:
        if (self.component_id is None) == (self.created_ref is None):
            raise ValueError("exactly one of component_id or created_ref is required")
        return self


class PortAddress(ComponentAddress):
    port: Annotated[str, Field(min_length=1, max_length=100)]


class CreateComponentMutation(FrozenModel):
    kind: Literal["create_component"] = "create_component"
    ref: Identifier
    primitive: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*@[1-9][0-9]*$")]
    config: dict[str, Any] = Field(default_factory=dict)


class CreateAssetSetMutation(FrozenModel):
    kind: Literal["create_asset_set"] = "create_asset_set"
    ref: Identifier
    assets: Annotated[tuple[Symbol, ...], Field(min_length=1)]


class SetComponentFieldMutation(FrozenModel):
    kind: Literal["set_component_field"] = "set_component_field"
    target: ComponentAddress
    field: Annotated[str, Field(min_length=1, max_length=100)]
    value: Any = None
    created_asset_set_ref: Identifier | None = None

    @model_validator(mode="after")
    def one_value_source(self) -> SetComponentFieldMutation:
        if self.created_asset_set_ref is not None and self.value is not None:
            raise ValueError("value and created_asset_set_ref are mutually exclusive")
        if self.created_asset_set_ref is None and self.value is None:
            raise ValueError("value or created_asset_set_ref is required")
        return self


class ConnectMutation(FrozenModel):
    kind: Literal["connect"] = "connect"
    source: PortAddress
    target: PortAddress


class DisconnectMutation(FrozenModel):
    kind: Literal["disconnect"] = "disconnect"
    source: PortAddress
    target: PortAddress


class RemoveComponentMutation(FrozenModel):
    kind: Literal["remove_component"] = "remove_component"
    target: ComponentAddress


CompositionMutation = Annotated[
    CreateComponentMutation
    | CreateAssetSetMutation
    | SetComponentFieldMutation
    | ConnectMutation
    | DisconnectMutation
    | RemoveComponentMutation,
    Field(discriminator="kind"),
]


class ComposeStrategyOperation(FrozenModel):
    kind: Literal["compose_strategy"] = "compose_strategy"
    mutations: Annotated[tuple[CompositionMutation, ...], Field(min_length=1, max_length=50)]


class CompositionResult(FrozenModel):
    strategy: CanonicalStrategyV1
    created_component_ids: dict[str, Identifier] = Field(default_factory=dict)
    created_asset_set_ids: dict[str, Identifier] = Field(default_factory=dict)


class PrimitiveCompositionCapability(FrozenModel):
    primitive: str
    category: str
    create_supported: bool
    reason: str | None = None


class CompositionCapabilities(FrozenModel):
    primitives: tuple[PrimitiveCompositionCapability, ...]
    mutation_kinds: tuple[str, ...]
    incomplete_working_states: Literal[False] = False


_NON_CREATABLE = {
    PrimitiveCategory.EVENT: "Schedules require entrypoint ownership and remain recipe-authored.",
    PrimitiveCategory.EFFECT: "Execution effects require entrypoint ownership and remain recipe-authored.",
    PrimitiveCategory.RULE: "Expression rules are outside the executable MVP composition grammar.",
}


def composition_capabilities() -> CompositionCapabilities:
    return CompositionCapabilities(
        primitives=tuple(
            PrimitiveCompositionCapability(
                primitive=item.id,
                category=item.category.value,
                create_supported=item.category not in _NON_CREATABLE,
                reason=_NON_CREATABLE.get(item.category),
            )
            for item in BUILTIN_REGISTRY.all()
        ),
        mutation_kinds=(
            "create_asset_set",
            "create_component",
            "set_component_field",
            "connect",
            "disconnect",
            "remove_component",
        ),
    )


def _generated_id(occupied: set[str], stem: str) -> str:
    normalized = stem.removesuffix("@1")
    candidate, suffix = normalized, 2
    while candidate in occupied:
        candidate = f"{normalized}_{suffix}"
        suffix += 1
    occupied.add(candidate)
    return candidate


def _resolve(address: ComponentAddress, created: dict[str, str], path: str) -> str:
    if address.component_id is not None:
        return address.component_id
    assert address.created_ref is not None
    try:
        return created[address.created_ref]
    except KeyError as exc:
        raise CompositionError(
            "unknown_created_ref", path, f"Created component ref '{address.created_ref}' is unavailable."
        ) from exc


def _component(strategy: CanonicalStrategyV1, component_id: str, path: str) -> Component:
    found = next((item for item in strategy.graph.components if item.id == component_id), None)
    if found is None:
        raise CompositionError("component_not_found", path, "The referenced component does not exist.")
    return found


def _port(address: PortAddress, created: dict[str, str], path: str) -> PortReference:
    return PortReference(component_id=_resolve(address, created, path), port=address.port)


def _validate_connection(
    strategy: CanonicalStrategyV1, source: PortReference, target: PortReference, path: str
) -> None:
    source_component = _component(strategy, source.component_id, f"{path}.source")
    target_component = _component(strategy, target.component_id, f"{path}.target")
    source_spec = BUILTIN_REGISTRY.get(source_component.primitive)
    target_spec = BUILTIN_REGISTRY.get(target_component.primitive)
    source_port = next((item for item in source_spec.outputs if item.name == source.port), None)
    target_port = next((item for item in target_spec.inputs if item.name == target.port), None)
    if source_port is None:
        raise CompositionError("unknown_output_port", f"{path}.source.port", "Unknown output port.")
    if target_port is None:
        raise CompositionError("unknown_input_port", f"{path}.target.port", "Unknown input port.")
    if source_port.value_type != target_port.value_type:
        raise CompositionError(
            "incompatible_ports",
            path,
            f"Cannot connect {source_port.value_type.value} to {target_port.value_type.value}.",
        )
    if not target_port.multiple and any(
        item.target.component_id == target.component_id and item.target.port == target.port
        for item in strategy.graph.connections
    ):
        raise CompositionError("input_occupied", f"{path}.target", "That input already has a connection.")


def apply_composition(
    strategy: CanonicalStrategyV1, operation: ComposeStrategyOperation
) -> CompositionResult:
    candidate = strategy
    occupied = {item.id for item in strategy.graph.components} | {
        item.id for item in strategy.definitions.asset_sets
    }
    created_components: dict[str, str] = {}
    created_asset_sets: dict[str, str] = {}
    for index, mutation in enumerate(operation.mutations):
        path = f"operation.mutations[{index}]"
        if isinstance(mutation, CreateComponentMutation):
            if mutation.ref in created_components or mutation.ref in created_asset_sets:
                raise CompositionError("duplicate_ref", f"{path}.ref", "Mutation refs must be unique.")
            try:
                primitive = BUILTIN_REGISTRY.get(mutation.primitive)
            except KeyError as exc:
                raise CompositionError("unknown_primitive", f"{path}.primitive", str(exc)) from exc
            reason = _NON_CREATABLE.get(primitive.category)
            if reason is not None:
                raise CompositionError("primitive_not_creatable", f"{path}.primitive", reason)
            component_id = _generated_id(occupied, mutation.primitive)
            created_components[mutation.ref] = component_id
            graph = candidate.graph.model_copy(
                update={
                    "components": (
                        *candidate.graph.components,
                        Component(id=component_id, primitive=mutation.primitive, config=mutation.config),
                    )
                }
            )
            candidate = candidate.model_copy(update={"graph": graph})
        elif isinstance(mutation, CreateAssetSetMutation):
            if mutation.ref in created_components or mutation.ref in created_asset_sets:
                raise CompositionError("duplicate_ref", f"{path}.ref", "Mutation refs must be unique.")
            definition_id = _generated_id(occupied, "assets")
            created_asset_sets[mutation.ref] = definition_id
            definitions = candidate.definitions.model_copy(
                update={
                    "asset_sets": (
                        *candidate.definitions.asset_sets,
                        AssetSetDefinition(id=definition_id, assets=list(mutation.assets)),
                    )
                }
            )
            candidate = candidate.model_copy(update={"definitions": definitions})
        elif isinstance(mutation, SetComponentFieldMutation):
            component_id = _resolve(mutation.target, created_components, f"{path}.target")
            component = _component(candidate, component_id, f"{path}.target")
            primitive = BUILTIN_REGISTRY.get(component.primitive)
            if mutation.field not in {item.name for item in primitive.fields}:
                raise CompositionError(
                    "unknown_component_field", f"{path}.field", "That field is not defined by the primitive."
                )
            value = mutation.value
            if mutation.created_asset_set_ref is not None:
                try:
                    value = created_asset_sets[mutation.created_asset_set_ref]
                except KeyError as exc:
                    raise CompositionError(
                        "unknown_created_ref",
                        f"{path}.created_asset_set_ref",
                        f"Created asset-set ref '{mutation.created_asset_set_ref}' is unavailable.",
                    ) from exc
            replacement = component.model_copy(update={"config": {**component.config, mutation.field: value}})
            graph = candidate.graph.model_copy(
                update={
                    "components": tuple(
                        replacement if item.id == component_id else item
                        for item in candidate.graph.components
                    )
                }
            )
            candidate = candidate.model_copy(update={"graph": graph})
        elif isinstance(mutation, ConnectMutation):
            source, target = (
                _port(mutation.source, created_components, f"{path}.source"),
                _port(mutation.target, created_components, f"{path}.target"),
            )
            connection = Connection(source=source, target=target)
            if connection in candidate.graph.connections:
                raise CompositionError("duplicate_connection", path, "That connection already exists.")
            _validate_connection(candidate, source, target, path)
            graph = candidate.graph.model_copy(
                update={"connections": (*candidate.graph.connections, connection)}
            )
            candidate = candidate.model_copy(update={"graph": graph})
        elif isinstance(mutation, DisconnectMutation):
            connection = Connection(
                source=_port(mutation.source, created_components, f"{path}.source"),
                target=_port(mutation.target, created_components, f"{path}.target"),
            )
            if connection not in candidate.graph.connections:
                raise CompositionError("connection_not_found", path, "That connection does not exist.")
            graph = candidate.graph.model_copy(
                update={
                    "connections": tuple(item for item in candidate.graph.connections if item != connection)
                }
            )
            candidate = candidate.model_copy(update={"graph": graph})
        else:
            component_id = _resolve(mutation.target, created_components, f"{path}.target")
            _component(candidate, component_id, f"{path}.target")
            graph = candidate.graph.model_copy(
                update={
                    "components": tuple(
                        item for item in candidate.graph.components if item.id != component_id
                    ),
                    "connections": tuple(
                        item
                        for item in candidate.graph.connections
                        if item.source.component_id != component_id
                        and item.target.component_id != component_id
                    ),
                }
            )
            candidate = candidate.model_copy(update={"graph": graph})
    referenced = {
        str(value)
        for item in candidate.graph.components
        for value in item.config.values()
        if isinstance(value, str)
    }
    if set(created_asset_sets.values()) - referenced:
        raise CompositionError(
            "unused_created_asset_set",
            "operation.mutations",
            "Every newly created asset set must be referenced by the completed mutation batch.",
        )
    try:
        validate_strategy_v1(candidate)
    except StrategySemanticError as exc:
        issue = exc.issues[0]
        raise CompositionError(
            "result_invalid",
            issue.path,
            f"The composition batch would make the strategy invalid: {issue.message}",
        ) from exc
    return CompositionResult(
        strategy=candidate, created_component_ids=created_components, created_asset_set_ids=created_asset_sets
    )
