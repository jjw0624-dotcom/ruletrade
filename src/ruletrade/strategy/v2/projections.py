"""UI-independent semantic projection contracts for ``SemanticProgramV2``.

These manifests are not presentation models and never become an authoring source.
They provide stable semantic addresses, deterministic ordering, explicit omission,
and view-specific meaning that future Builder surfaces may render.
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    BooleanGroupV2,
    CanonicalStrategyV2,
    ComparisonV2,
    ConditionalStatementV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    NOfMConditionV2,
    NotConditionV2,
    ProgramStatementV2,
    RememberValueStatementV2,
    ScoreValueV2,
    SelectionStatementV2,
    StateTransitionStatementV2,
    UnresolvedStatementV2,
)
from ruletrade.strategy.v2.semantic_types import FrozenModel
from ruletrade.strategy.v2.validation import validate_strategy_v2


ProjectionKind = Literal["structure", "flow", "blocky", "rules", "summary"]


class SemanticAddress(FrozenModel):
    kind: Literal["strategy", "definition", "statement", "condition", "value", "clock"]
    semantic_id: str
    canonical_path: str


class ProjectionItem(FrozenModel):
    id: str
    role: str
    label: str
    address: SemanticAddress
    parent_id: str | None = None
    order: int = Field(ge=0)
    detail: str | None = None
    route: Literal["contains", "capital", "selected", "fallback", "action", "computes"] | None = None


class ProjectionManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/semantic-projection/v1"] = "ruletrade.dev/semantic-projection/v1"
    kind: ProjectionKind
    strategy_id: str
    items: tuple[ProjectionItem, ...]
    omitted: tuple[str, ...] = ()
    semantic_valid: bool
    execution_claim: Literal["none", "incomplete", "supported", "unsupported"] = "none"

    @model_validator(mode="after")
    def validate_identity(self) -> "ProjectionManifest":
        ids = [item.id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError(f"duplicate {self.kind} projection identity")
        known = set(ids)
        if any(item.parent_id is not None and item.parent_id not in known for item in self.items):
            raise ValueError(f"{self.kind} projection contains an unknown parent")
        return self


class InspectorIntent(FrozenModel):
    address: SemanticAddress
    valid_operations: tuple[str, ...]
    read_only_reason: str | None = None


class InspectorAddressManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/inspector-address/v1"] = "ruletrade.dev/inspector-address/v1"
    strategy_id: str
    intents: tuple[InspectorIntent, ...]


def _address(kind: SemanticAddress.__annotations__["kind"], semantic_id: str, path: str) -> SemanticAddress:
    return SemanticAddress(kind=kind, semantic_id=semantic_id, canonical_path=path)


def _condition_label(condition) -> str:
    if isinstance(condition, ComparisonV2):
        return f"Compare {condition.left.semantic_id} {condition.operator} {condition.right.semantic_id}"
    if isinstance(condition, BooleanGroupV2):
        return f"{condition.kind.upper()} · {len(condition.children)} clauses"
    if isinstance(condition, NOfMConditionV2):
        return f"{condition.minimum_true} of {len(condition.children)} clauses"
    if isinstance(condition, NotConditionV2):
        return "NOT"
    if condition.kind == "state_equals":
        return f"State {condition.state_key} is {condition.expected}"
    if condition.kind == "event_window":
        suffix = f" {condition.observations} observations" if condition.observations is not None else ""
        return f"{condition.relation} {condition.event_id}{suffix}"
    return condition.kind


def _statement_label(statement: ProgramStatementV2) -> tuple[str, str]:
    if isinstance(statement, SelectionStatementV2):
        return "selection", f"Choose {statement.selection.count} assets"
    if isinstance(statement, AllocationStatementV2):
        return "allocation", f"Allocate · {statement.method.replace('_', ' ')}"
    if isinstance(statement, ConditionalStatementV2):
        return "control", f"IF {_condition_label(statement.condition)}"
    if isinstance(statement, EventStatementV2):
        return "event", f"On {statement.event.trigger.replace('_', ' ')}"
    if isinstance(statement, StateTransitionStatementV2):
        value = statement.transition
        return "transition", f"Set {value.state_key} to {value.to_value}"
    if isinstance(statement, RememberValueStatementV2):
        return "memory", f"Remember {statement.memory_id}"
    if isinstance(statement, GuardedAllocationStatementV2):
        return "policy", "Guarded allocation policy"
    if isinstance(statement, UnresolvedStatementV2):
        return "unresolved", f"Unresolved · {statement.source_text}"
    raise TypeError(f"unsupported statement: {type(statement)!r}")


def _statement_children(statement: ProgramStatementV2) -> tuple[tuple[str, ProgramStatementV2], ...]:
    if isinstance(statement, ConditionalStatementV2):
        return tuple(("then", item) for item in statement.then_statements) + tuple(
            ("otherwise", item) for item in statement.otherwise_statements
        )
    if isinstance(statement, EventStatementV2):
        return tuple(("event", item) for item in statement.statements)
    if isinstance(statement, GuardedAllocationStatementV2):
        result: list[tuple[str, ProgramStatementV2]] = [("primary", statement.primary)]
        result.extend((f"override:{item.priority}", item.action) for item in statement.overrides)
        if statement.fallback is not None:
            result.append(("fallback", statement.fallback))
        return tuple(result)
    return ()


def project_structure(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    program = strategy.program
    strategy_id = program.semantic_id if program else strategy.metadata.name
    root_id = f"structure:{strategy_id}"
    items = [ProjectionItem(
        id=root_id, role="portfolio", label="Portfolio",
        address=_address("strategy", strategy_id, "program"), order=0,
    )]
    asset_sets = {item.id: item for item in strategy.definitions.asset_sets}
    selections = {
        item.selection.universe_id: item
        for item in (program.statements if program else ())
        if isinstance(item, SelectionStatementV2)
    }
    allocations = {
        leg.target.ref: statement
        for statement in (program.statements if program else ())
        if isinstance(statement, AllocationStatementV2)
        for leg in statement.legs
        if leg.target.kind == "selection" and leg.target.ref is not None
    }
    order = 1
    for index, group in enumerate(strategy.definitions.groups):
        investment_id = f"structure:investment:{group.id}"
        items.append(ProjectionItem(
            id=investment_id, role="investment", label=group.name or "Investment",
            address=_address("definition", group.id, f"definitions.groups[{index}]"),
            parent_id=root_id, order=order, route="contains",
        ))
        order += 1
        assets = asset_sets[group.asset_set_ref].assets
        items.append(ProjectionItem(
            id=f"structure:assets:{group.id}", role="assets", label="Assets",
            detail=", ".join(assets) if assets else "No assets",
            address=_address("definition", group.asset_set_ref, f"definitions.asset_sets[{group.asset_set_ref}]"),
            parent_id=investment_id, order=order, route="contains",
        ))
        order += 1
        selected = selections.get(group.id)
        if selected is not None:
            if selected.selection.eligibility is not None:
                items.append(ProjectionItem(
                    id=f"structure:qualification:{selected.selection.eligibility.semantic_id}",
                    role="qualification", label="Qualification",
                    detail=_condition_label(selected.selection.eligibility),
                    address=_address("condition", selected.selection.eligibility.semantic_id, f"program.statements[{selected.semantic_id}].selection.eligibility"),
                    parent_id=investment_id, order=order, route="contains",
                ))
                order += 1
            items.append(ProjectionItem(
                id=f"structure:selection:{selected.semantic_id}", role="selection",
                label=f"Choose {selected.selection.count} assets",
                address=_address("statement", selected.semantic_id, f"program.statements[{selected.semantic_id}]"),
                parent_id=investment_id, order=order, route="contains",
            ))
            order += 1
            if selected.selection.fallback_asset:
                items.append(ProjectionItem(
                    id=f"structure:fallback:{selected.semantic_id}", role="fallback", label="Fallback",
                    detail=selected.selection.fallback_asset,
                    address=_address("statement", selected.semantic_id, f"program.statements[{selected.semantic_id}].selection.fallback_asset"),
                    parent_id=investment_id, order=order, route="contains",
                ))
                order += 1
            allocation = allocations.get(selected.output_id)
            if allocation is not None:
                items.append(ProjectionItem(
                    id=f"structure:allocation:{allocation.semantic_id}",
                    role="allocation",
                    label="Allocation",
                    detail=allocation.method.replace("_", " "),
                    address=_address(
                        "statement", allocation.semantic_id,
                        f"program.statements[{allocation.semantic_id}]",
                    ),
                    parent_id=investment_id,
                    order=order,
                    route="contains",
                ))
                order += 1
    for index, clock in enumerate(program.clocks if program else ()):
        if clock.timeframe != "daily" or clock.id != "daily-close":
            items.append(ProjectionItem(
                id=f"structure:clock:{clock.id}", role="rebalance", label="Rebalance",
                detail=clock.timeframe.title(),
                address=_address("clock", clock.id, f"program.clocks[{index}]"),
                parent_id=root_id, order=order, route="contains",
            ))
            order += 1
    return ProjectionManifest(
        kind="structure", strategy_id=strategy_id, items=tuple(items),
        omitted=("mathematical operator internals", "execution diagnostics"),
        semantic_valid=not validate_strategy_v2(strategy),
    )


def project_flow(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    structure = project_structure(strategy)
    relevant = [item for item in structure.items if item.role in {"portfolio", "investment", "selection", "fallback", "rebalance"}]
    items: list[ProjectionItem] = []
    previous_by_investment: dict[str, str] = {}
    for order, item in enumerate(relevant):
        parent_id = None
        route: ProjectionItem.__annotations__["route"] = "capital"
        if item.role == "investment":
            parent_id = next(candidate.id for candidate in relevant if candidate.role == "portfolio")
            previous_by_investment[item.id] = item.id
        elif item.role == "selection":
            structure_parent = next(candidate for candidate in structure.items if candidate.id == item.parent_id)
            parent_id = previous_by_investment.get(structure_parent.id, structure_parent.id.replace("structure:", "flow:"))
        elif item.role == "fallback":
            selected = next(
                candidate for candidate in relevant
                if candidate.role == "selection" and candidate.parent_id == item.parent_id
            )
            parent_id = selected.id.replace("structure:", "flow:")
            route = "fallback"
        elif item.role == "rebalance":
            selection = next((candidate for candidate in reversed(relevant) if candidate.role == "selection"), None)
            parent_id = selection.id.replace("structure:", "flow:") if selection else relevant[0].id.replace("structure:", "flow:")
            route = "action"
        items.append(item.model_copy(update={
            "id": item.id.replace("structure:", "flow:"),
            "parent_id": parent_id.replace("structure:", "flow:") if parent_id else None,
            "order": order,
            "route": route,
        }))
        if item.role == "selection":
            items.append(ProjectionItem(
                id=f"flow:selected:{item.address.semantic_id}", role="destination",
                label="Selected assets", address=item.address,
                parent_id=item.id.replace("structure:", "flow:"), order=order + 1, route="selected",
            ))
    return ProjectionManifest(
        kind="flow", strategy_id=structure.strategy_id, items=tuple(items),
        omitted=("indicator calculations", "condition expression internals"),
        semantic_valid=structure.semantic_valid,
    )


def project_blocky(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    program = strategy.program
    strategy_id = program.semantic_id if program else strategy.metadata.name
    items: list[ProjectionItem] = []

    def visit_value(value, path: str, parent_id: str, detail: str | None = None) -> None:
        item_id = f"blocky:value:{value.semantic_id}"
        if any(item.id == item_id for item in items):
            return
        label = f"Value · {value.kind.replace('_', ' ')}"
        if isinstance(value, ScoreValueV2):
            label = "Score · weighted terms"
        items.append(ProjectionItem(
            id=item_id,
            role="value",
            label=label,
            detail=detail,
            address=_address("value", value.semantic_id, path),
            parent_id=parent_id,
            order=len(items),
            route="computes",
        ))
        if isinstance(value, ScoreValueV2):
            for index, term in enumerate(value.terms):
                visit_value(
                    term.value,
                    f"{path}.terms[{index}].value",
                    item_id,
                    f"weight={term.weight}",
                )

    def visit(statement: ProgramStatementV2, path: str, parent_id: str | None, relation: str | None = None) -> None:
        role, label = _statement_label(statement)
        item_id = f"blocky:{statement.semantic_id}"
        items.append(ProjectionItem(
            id=item_id, role=role, label=label,
            detail=relation,
            address=_address("statement", statement.semantic_id, path),
            parent_id=parent_id, order=len(items), route="computes" if parent_id else None,
        ))
        condition = None
        if isinstance(statement, SelectionStatementV2):
            condition = statement.selection.eligibility
        elif isinstance(statement, ConditionalStatementV2):
            condition = statement.condition
        elif isinstance(statement, EventStatementV2):
            condition = statement.event.condition
        elif isinstance(statement, StateTransitionStatementV2):
            condition = statement.transition.when
        elif isinstance(statement, GuardedAllocationStatementV2):
            condition = statement.guard
        if condition is not None:
            items.append(ProjectionItem(
                id=f"blocky:condition:{condition.semantic_id}", role="condition",
                label=_condition_label(condition),
                address=_address("condition", condition.semantic_id, f"{path}.condition"),
                parent_id=item_id, order=len(items), route="computes",
            ))
        if isinstance(statement, SelectionStatementV2):
            ranking = statement.selection.ranking
            visit_value(
                ranking,
                f"{path}.selection.ranking",
                item_id,
                f"rank {statement.selection.direction}",
            )
        for index, (child_relation, child) in enumerate(_statement_children(statement)):
            visit(child, f"{path}.{child_relation}[{index}]", item_id, child_relation)

    for index, statement in enumerate(program.statements if program else ()):
        visit(statement, f"program.statements[{index}]", None)
    return ProjectionManifest(
        kind="blocky", strategy_id=strategy_id, items=tuple(items),
        omitted=("portfolio ownership decoration", "provider/runtime status"),
        semantic_valid=not validate_strategy_v2(strategy),
    )


def project_rules(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    blocky = project_blocky(strategy)
    items = tuple(item.model_copy(update={
        "id": item.id.replace("blocky:", "rules:"),
        "parent_id": None,
        "route": None,
        "label": f"{item.order + 1}. {item.label}",
    }) for item in blocky.items if item.role != "condition")
    return ProjectionManifest(
        kind="rules", strategy_id=blocky.strategy_id, items=items,
        omitted=("visual containment", "execution diagnostics"),
        semantic_valid=blocky.semantic_valid,
    )


def project_summary(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    structure = project_structure(strategy)
    investments = sum(item.role == "investment" for item in structure.items)
    selections = [item for item in structure.items if item.role == "selection"]
    if not investments:
        summary = "A portfolio ready for its first investment."
    elif not selections:
        summary = f"{investments} investment{'s' if investments != 1 else ''} ready for selection rules."
    else:
        summary = "; ".join(item.label for item in selections)
    root = ProjectionItem(
        id=f"summary:{structure.strategy_id}", role="summary", label=strategy.metadata.name,
        detail=summary, address=_address("strategy", structure.strategy_id, "program"), order=0,
    )
    return ProjectionManifest(
        kind="summary", strategy_id=structure.strategy_id, items=(root,),
        omitted=("operator internals", "full rule order", "runtime availability"),
        semantic_valid=structure.semantic_valid,
    )


def inspector_addresses(strategy: CanonicalStrategyV2) -> InspectorAddressManifest:
    blocky = project_blocky(strategy)
    operations = {
        "selection": ("set_selection_assets", "set_selection_eligibility", "set_selection_ranking", "set_selection_fallback"),
        "allocation": ("set_allocation",),
        "condition": ("replace_condition",),
        "event": ("replace_event",),
        "transition": ("replace_transition",),
        "memory": ("replace_remembered_value",),
        "policy": ("replace_policy",),
        "control": ("replace_control",),
    }
    intents = tuple(InspectorIntent(
        address=item.address,
        valid_operations=operations.get(item.role, ()),
        read_only_reason=None if item.role in operations else "No production authoring operation is registered for this semantic role.",
    ) for item in blocky.items)
    return InspectorAddressManifest(strategy_id=blocky.strategy_id, intents=intents)


def projection_bundle(strategy: CanonicalStrategyV2) -> dict[ProjectionKind, ProjectionManifest]:
    return {
        "structure": project_structure(strategy),
        "flow": project_flow(strategy),
        "blocky": project_blocky(strategy),
        "rules": project_rules(strategy),
        "summary": project_summary(strategy),
    }
