from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field

from ruletrade.strategy.v1.models import (
    CanonicalStrategyV1,
    Component,
    Connection,
    FrozenModel,
    Identifier,
    PortReference,
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


StructuralAuthoringOperation = Annotated[
    RenameGroupOperation
    | AddQualificationConditionOperation
    | RemoveQualificationConditionOperation,
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
    create_choose_pipeline: Literal[False] = False


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


def apply_structural_operation(
    strategy: CanonicalStrategyV1,
    operation: StructuralAuthoringOperation,
) -> CanonicalStrategyV1:
    if isinstance(operation, RenameGroupOperation):
        candidate = _rename(strategy, operation)
    elif isinstance(operation, AddQualificationConditionOperation):
        candidate = _add(strategy, operation)
    else:
        candidate = _remove(strategy, operation)
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
    return StructuralAuthoringCapabilities(
        groups=groups,
        qualification_add_targets=tuple(add_targets),
        qualification_remove_targets=tuple(remove_targets),
        rename_group=bool(groups),
        add_qualification_condition=bool(add_targets),
        remove_qualification_condition=bool(remove_targets),
    )
