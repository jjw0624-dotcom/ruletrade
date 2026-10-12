"""UI-independent semantic projection contracts for ``SemanticProgramV2``.

These manifests are not presentation models and never become an authoring source.
They provide stable semantic addresses, deterministic ordering, explicit omission,
and view-specific meaning that future Builder surfaces may render.
"""
from __future__ import annotations

from decimal import Decimal
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


class ProjectionLink(FrozenModel):
    source_id: str
    target_id: str
    route: Literal["contains", "capital", "selected", "fallback", "action", "computes"]
    label: str | None = None


class ProjectionManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/semantic-projection/v1"] = "ruletrade.dev/semantic-projection/v1"
    kind: ProjectionKind
    strategy_id: str
    items: tuple[ProjectionItem, ...]
    links: tuple[ProjectionLink, ...] = ()
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
        if any(link.source_id not in known or link.target_id not in known for link in self.links):
            raise ValueError(f"{self.kind} projection contains an unknown link endpoint")
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


def _execution_claim(strategy: CanonicalStrategyV2) -> Literal["none", "incomplete", "supported", "unsupported"]:
    # Capability is a separate projection dimension.  Rendering never requires
    # successful lowering, but consumers may truthfully label Test readiness.
    from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability

    state = assess_v2_execution_capability(strategy).execution_state
    return {"incomplete": "incomplete", "unsupported": "unsupported", "executable": "supported"}[state]


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


def _is_blank_bootstrap(statement: ProgramStatementV2) -> bool:
    return (
        isinstance(statement, AllocationStatementV2)
        and statement.semantic_id == "initial-retain-allocation"
        and len(statement.legs) == 1
        and statement.legs[0].target.kind == "retain"
    )


def _all_statements(items: tuple[ProgramStatementV2, ...]) -> tuple[ProgramStatementV2, ...]:
    result: list[ProgramStatementV2] = []
    for statement in items:
        result.append(statement)
        for _, child in _statement_children(statement):
            result.extend(_all_statements((child,)))
    return tuple(result)


def project_structure(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    program = strategy.program
    strategy_id = program.semantic_id if program else strategy.metadata.name
    root_id = f"structure:{strategy_id}"
    items = [ProjectionItem(
        id=root_id, role="portfolio", label="Portfolio",
        address=_address("strategy", strategy_id, "program"), order=0,
    )]
    asset_sets = {item.id: item for item in strategy.definitions.asset_sets}
    statements = _all_statements(program.statements if program else ())
    selections = {
        item.selection.universe_id: item
        for item in statements
        if isinstance(item, SelectionStatementV2)
    }
    allocations = {
        leg.target.ref: statement
        for statement in statements
        if isinstance(statement, AllocationStatementV2)
        if sum(item.target.kind == "selection" for item in statement.legs) == 1
        for leg in statement.legs
        if leg.target.kind == "selection" and leg.target.ref is not None
    }
    order = 1
    split_shares: dict[str, Decimal] = {}
    split_statement: AllocationStatementV2 | None = None
    selections_by_output = {
        item.output_id: item for item in statements if isinstance(item, SelectionStatementV2)
    }
    for statement in (item for item in statements if isinstance(item, AllocationStatementV2) and item.method == "fixed"):
        candidate: dict[str, Decimal] = {}
        for leg in statement.legs:
            group_id = leg.target.ref if leg.target.kind == "group" else None
            if leg.target.kind == "selection":
                selected = selections_by_output.get(leg.target.ref or "")
                group_id = selected.selection.universe_id if selected else None
            if group_id is not None and leg.weight is not None:
                candidate[group_id] = leg.weight
        if len(candidate) > 1:
            split_shares, split_statement = candidate, statement
            break
    split_id = None
    if split_statement is not None:
        split_id = f"structure:split:{split_statement.semantic_id}"
        items.append(ProjectionItem(
            id=split_id, role="split", label="Split",
            detail=" / ".join(f"{float(value):.0%}" for value in split_shares.values()),
            address=_address("statement", split_statement.semantic_id, f"program.statements[{split_statement.semantic_id}]"),
            parent_id=root_id, order=order, route="contains",
        ))
        order += 1
    for index, group in enumerate(strategy.definitions.groups):
        investment_id = f"structure:investment:{group.id}"
        items.append(ProjectionItem(
            id=investment_id, role="investment", label=group.name or "Investment",
            address=_address("definition", group.id, f"definitions.groups[{index}]"),
            parent_id=split_id or root_id, order=order, route="contains",
            detail=(f"{float(split_shares[group.id]):.0%} of Portfolio" if group.id in split_shares else None),
        ))
        order += 1
        assets = asset_sets.get(group.asset_set_ref)
        items.append(ProjectionItem(
            id=f"structure:assets:{group.id}", role="assets", label="Assets",
            detail=", ".join(assets.assets) if assets and assets.assets else "No assets",
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
    used_clock_ids = {
        item.clock_id for item in selections.values() if item.clock_id is not None
    }
    for index, clock in enumerate(program.clocks if program else ()):
        if selections and (clock.id in used_clock_ids or (not used_clock_ids and index == 0)):
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
        execution_claim=_execution_claim(strategy),
    )


def project_flow(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    structure = project_structure(strategy)
    relevant = [item for item in structure.items if item.role in {"portfolio", "split", "investment", "selection", "fallback", "rebalance"}]
    items: list[ProjectionItem] = []
    links: list[ProjectionLink] = []
    endpoints: list[str] = []
    for order, item in enumerate(relevant):
        flow_id = item.id.replace("structure:", "flow:")
        parent_id = item.parent_id.replace("structure:", "flow:") if item.parent_id else None
        route: ProjectionItem.__annotations__["route"] = "capital"
        if item.role == "fallback":
            selected = next(
                candidate for candidate in relevant
                if candidate.role == "selection" and candidate.parent_id == item.parent_id
            )
            parent_id = selected.id.replace("structure:", "flow:")
            route = "fallback"
        elif item.role == "rebalance":
            parent_id = None
            route = "action"
        items.append(item.model_copy(update={
            "id": flow_id,
            "parent_id": parent_id,
            "order": order,
            "route": route,
        }))
        if parent_id:
            links.append(ProjectionLink(source_id=parent_id, target_id=flow_id, route=route))
        if item.role == "selection":
            selected_id = f"flow:selected:{item.address.semantic_id}"
            items.append(ProjectionItem(
                id=selected_id, role="destination",
                label="Selected assets", address=item.address,
                parent_id=flow_id, order=order + 1, route="selected",
            ))
            links.append(ProjectionLink(source_id=flow_id, target_id=selected_id, route="selected"))
            endpoints.append(selected_id)
        elif item.role == "fallback":
            endpoints.append(flow_id)
        elif item.role == "investment" and not any(candidate.role == "selection" and candidate.parent_id == item.id for candidate in relevant):
            endpoints.append(flow_id)
    rebalance = next((item for item in items if item.role == "rebalance"), None)
    if rebalance is not None:
        links.extend(ProjectionLink(source_id=source, target_id=rebalance.id, route="action") for source in dict.fromkeys(endpoints))
    return ProjectionManifest(
        kind="flow", strategy_id=structure.strategy_id, items=tuple(items), links=tuple(links),
        omitted=("indicator calculations", "condition expression internals"),
        semantic_valid=structure.semantic_valid,
        execution_claim=structure.execution_claim,
    )


def project_blocky(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    program = strategy.program
    strategy_id = program.semantic_id if program else strategy.metadata.name
    root_id = f"blocky:context:{strategy_id}"
    items: list[ProjectionItem] = [ProjectionItem(
        id=root_id, role="portfolio", label="Portfolio",
        address=_address("strategy", strategy_id, "program"), order=0,
    )]

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
            for index, term in enumerate(value.condition_terms):
                visit_condition(
                    term.condition,
                    f"{path}.condition_terms[{index}].condition",
                    item_id,
                    f"points={term.true_points}",
                )
        elif hasattr(value, "source"):
            visit_value(value.source, f"{path}.source", item_id)
        elif hasattr(value, "operands"):
            for index, operand in enumerate(value.operands):
                visit_value(operand, f"{path}.operands[{index}]", item_id)

    def visit_condition(condition, path: str, parent_id: str, detail: str | None = None) -> None:
        item_id = f"blocky:condition:{condition.semantic_id}"
        if any(item.id == item_id for item in items):
            return
        items.append(ProjectionItem(
            id=item_id, role="condition", label=_condition_label(condition), detail=detail,
            address=_address("condition", condition.semantic_id, path),
            parent_id=parent_id, order=len(items), route="computes",
        ))
        if isinstance(condition, ComparisonV2):
            visit_value(condition.left, f"{path}.left", item_id)
            visit_value(condition.right, f"{path}.right", item_id)
        elif isinstance(condition, (BooleanGroupV2, NOfMConditionV2)):
            for index, child in enumerate(condition.children):
                visit_condition(child, f"{path}.children[{index}]", item_id)
        elif isinstance(condition, NotConditionV2):
            visit_condition(condition.child, f"{path}.child", item_id)

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
            visit_condition(condition, f"{path}.condition", item_id)
        if isinstance(statement, SelectionStatementV2):
            ranking = statement.selection.ranking
            visit_value(
                ranking,
                f"{path}.selection.ranking",
                item_id,
                f"rank {statement.selection.direction}",
            )
            if statement.selection.fallback_asset:
                items.append(ProjectionItem(
                    id=f"blocky:fallback:{statement.semantic_id}", role="fallback",
                    label=f"Fallback → {statement.selection.fallback_asset}",
                    address=_address("statement", statement.semantic_id, f"{path}.selection.fallback_asset"),
                    parent_id=item_id, order=len(items), route="computes",
                ))
        for index, (child_relation, child) in enumerate(_statement_children(statement)):
            visit(child, f"{path}.{child_relation}[{index}]", item_id, child_relation)

    for index, statement in enumerate(program.statements if program else ()):
        if not _is_blank_bootstrap(statement):
            visit(statement, f"program.statements[{index}]", root_id)
    return ProjectionManifest(
        kind="blocky", strategy_id=strategy_id, items=tuple(items),
        omitted=("portfolio ownership decoration", "provider/runtime status"),
        semantic_valid=not validate_strategy_v2(strategy),
        execution_claim=_execution_claim(strategy),
    )


def project_rules(strategy: CanonicalStrategyV2) -> ProjectionManifest:
    blocky = project_blocky(strategy)
    readable = [item for item in blocky.items if item.role not in {"portfolio", "condition", "value"}]
    items = tuple(item.model_copy(update={
        "id": item.id.replace("blocky:", "rules:"),
        "parent_id": None,
        "order": index,
        "route": None,
        "label": f"{index + 1}. {item.label}",
    }) for index, item in enumerate(readable))
    return ProjectionManifest(
        kind="rules", strategy_id=blocky.strategy_id, items=items,
        omitted=("visual containment", "execution diagnostics"),
        semantic_valid=blocky.semantic_valid,
        execution_claim=blocky.execution_claim,
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
        execution_claim=structure.execution_claim,
    )


def inspector_addresses(strategy: CanonicalStrategyV2) -> InspectorAddressManifest:
    bundle = projection_bundle(strategy)
    operations = {
        "investment": ("remove_program_investment",),
        "assets": ("set_program_asset_set",),
        "selection": ("set_selection_assets", "set_selection_eligibility", "set_selection_ranking", "set_selection_fallback", "set_program_selection", "set_program_condition", "set_program_value", "set_program_fallback"),
        "fallback": ("set_program_fallback",),
        "allocation": ("set_program_allocation",),
        "condition": ("set_program_condition",),
        "event": ("set_program_event",),
        "transition": ("set_program_transition",),
        "memory": ("set_program_value",),
        "policy": ("set_program_condition", "set_program_allocation"),
        "control": ("set_program_condition",),
        "split": ("set_program_split",),
        "rebalance": ("set_program_schedule",),
    }
    by_address: dict[tuple[str, str, str], tuple[SemanticAddress, set[str]]] = {}
    for manifest in bundle.values():
        for item in manifest.items:
            key = (item.address.kind, item.address.semantic_id, item.address.canonical_path)
            known = by_address.setdefault(key, (item.address, set()))
            known[1].update(operations.get(item.role, ()))
    intents = tuple(InspectorIntent(
        address=item,
        valid_operations=tuple(sorted(valid)),
        read_only_reason=None if valid else "No production authoring operation is registered for this semantic role.",
    ) for item, valid in by_address.values())
    return InspectorAddressManifest(strategy_id=next(iter(bundle.values())).strategy_id, intents=intents)


def projection_bundle(strategy: CanonicalStrategyV2) -> dict[ProjectionKind, ProjectionManifest]:
    return {
        "structure": project_structure(strategy),
        "flow": project_flow(strategy),
        "blocky": project_blocky(strategy),
        "rules": project_rules(strategy),
        "summary": project_summary(strategy),
    }
