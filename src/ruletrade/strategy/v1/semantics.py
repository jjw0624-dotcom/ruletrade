from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from ruletrade.strategy.v1.authoring import (
    AddFallbackSelectionOperation,
    SleeveAllocationInput,
    StructuralAuthoringOperation,
    TransformToGrowthDefensiveOperation,
    UpdateCooldownDurationOperation,
    UpdateLookbackOperation,
    UpdateQualificationThresholdOperation,
    UpdateScheduleOperation,
    UpdateSelectionCountOperation,
    UpdateSleeveAllocationsOperation,
    apply_structural_operation,
)
from ruletrade.strategy.v1.composition import (
    ComponentAddress,
    ComposeStrategyOperation,
    SetComponentFieldMutation,
)
from ruletrade.strategy.v1.models import (
    CanonicalStrategyV1,
    Component,
    ComponentOutputExpression,
    ComparisonExpression,
    FrozenModel,
    Identifier,
    IndicatorExpression,
    LiteralExpression,
    RebalanceAction,
    Symbol,
)
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY


class SemanticCategory(StrEnum):
    UNIVERSE = "universe"
    MEASURE = "measure"
    ELIGIBILITY = "eligibility"
    PREDICATE = "predicate"
    SELECTION = "selection"
    ACTION = "action"
    ALLOCATION = "allocation"
    CONSTRAINT = "constraint"
    PORTFOLIO = "portfolio"
    TIMING = "timing"
    STATE = "state"


class InformationPlacement(StrEnum):
    PRIMARY_VISIBLE = "primary_visible"
    COMPRESSED_RECOVERABLE = "compressed_recoverable"
    INSPECTOR_DETAIL = "inspector_detail"
    NOT_MEANINGFUL = "not_meaningful_in_this_perspective"
    UNSUPPORTED = "unsupported"


class SemanticProjectionRef(FrozenModel):
    """Derived address for an aggregate semantic unit; Canonical IDs remain authoritative."""

    primary_component_id: Identifier | None = None
    related_component_ids: tuple[Identifier, ...] = ()
    semantic_role: SemanticCategory
    field_path: str | None = None
    definition_id: Identifier | None = None

    @model_validator(mode="after")
    def has_canonical_identity(self) -> SemanticProjectionRef:
        if self.primary_component_id is None and self.definition_id is None:
            raise ValueError("a projection ref requires Canonical component or definition identity")
        return self


class SemanticFact(FrozenModel):
    id: str
    category: SemanticCategory
    kind: str
    label: str
    ref: SemanticProjectionRef
    detail: dict[str, Any] = Field(default_factory=dict)


class FactPlacement(FrozenModel):
    fact_id: str
    placement: InformationPlacement
    unit_id: str | None = None


class FlowSemanticUnit(FrozenModel):
    id: str
    family: Literal["entity", "distribution", "routing", "action", "timing_annotation"]
    kind: str
    label: str
    ref: SemanticProjectionRef
    fact_ids: tuple[str, ...]


class FlowSemanticEdge(FrozenModel):
    source_unit_id: str
    target_unit_id: str
    kind: Literal["capital", "ownership", "routing", "timing"]


class FlowSemanticProjection(FrozenModel):
    units: tuple[FlowSemanticUnit, ...]
    edges: tuple[FlowSemanticEdge, ...]
    placements: tuple[FactPlacement, ...]


class LogicTrigger(FrozenModel):
    timing_fact_id: str
    ref: SemanticProjectionRef


class LogicStatement(FrozenModel):
    id: str
    family: Literal["control", "selection", "action", "portfolio_operation"]
    kind: str
    label: str
    ref: SemanticProjectionRef
    fact_ids: tuple[str, ...]
    modifier_fact_ids: tuple[str, ...] = ()
    then_statement_ids: tuple[str, ...] = ()
    else_statement_ids: tuple[str, ...] = ()


class LogicScript(FrozenModel):
    id: str
    context_id: str
    trigger: LogicTrigger
    statements: tuple[LogicStatement, ...]
    execution_order_semantic: Literal[True] = True


class LogicContext(FrozenModel):
    id: str
    kind: Literal["portfolio", "sleeve", "investment", "asset"]
    label: str
    ref: SemanticProjectionRef
    fact_ids: tuple[str, ...] = ()
    script_ids: tuple[str, ...]


class LogicSemanticProjection(FrozenModel):
    contexts: tuple[LogicContext, ...]
    scripts: tuple[LogicScript, ...]
    placements: tuple[FactPlacement, ...]


class SemanticCompositionProjection(FrozenModel):
    facts: tuple[SemanticFact, ...]
    flow: FlowSemanticProjection
    logic: LogicSemanticProjection


class _Graph:
    def __init__(self, strategy: CanonicalStrategyV1) -> None:
        self.strategy = strategy
        self.components = {item.id: item for item in strategy.graph.components}
        self.incoming: dict[str, list[str]] = defaultdict(list)
        self.outgoing: dict[str, list[str]] = defaultdict(list)
        for connection in strategy.graph.connections:
            self.incoming[connection.target.component_id].append(connection.source.component_id)
            self.outgoing[connection.source.component_id].append(connection.target.component_id)
        for component in strategy.graph.components:
            for action in (*component.actions, *component.else_actions):
                if isinstance(action, RebalanceAction) and isinstance(
                    action.targets, ComponentOutputExpression
                ):
                    self.incoming[component.id].append(action.targets.component_id)
                    self.outgoing[action.targets.component_id].append(component.id)

    def ancestors(self, component_id: str) -> set[str]:
        result: set[str] = set()
        pending = [component_id]
        while pending:
            for source in self.incoming.get(pending.pop(), ()):
                if source not in result:
                    result.add(source)
                    pending.append(source)
        return result

    def upstream(self, component_id: str, primitive: str) -> Component | None:
        matches = [
            self.components[item]
            for item in self.ancestors(component_id)
            if self.components[item].primitive == primitive
        ]
        return matches[0] if len(matches) == 1 else None


def _resolved(component: Component, field: str) -> Any:
    return BUILTIN_REGISTRY.resolve_config(component.primitive, component.config).get(field)


def _ref(
    primary: Component, category: SemanticCategory, *related: Component, field: str | None = None
) -> SemanticProjectionRef:
    return SemanticProjectionRef(
        primary_component_id=primary.id,
        related_component_ids=tuple(item.id for item in related if item.id != primary.id),
        semantic_role=category,
        field_path=field,
    )


def _component_facts(strategy: CanonicalStrategyV1, graph: _Graph) -> list[SemanticFact]:
    definitions = {item.id: item for item in strategy.definitions.asset_sets}
    facts: list[SemanticFact] = []
    selection_members: set[str] = set()
    for component in strategy.graph.components:
        if component.primitive not in {"top_n@1", "random_select@1"}:
            continue
        measure = graph.upstream(component.id, "trailing_return@1")
        eligibility = graph.upstream(component.id, "filter@1")
        rank = graph.upstream(component.id, "rank@1")
        universe = graph.upstream(component.id, "asset_set@1")
        related = tuple(item for item in (universe, measure, eligibility, rank) if item)
        selection_members.update(item.id for item in related)
        detail = {"count": int(_resolved(component, "count"))}
        if component.primitive == "random_select@1":
            detail.update({"mode": "random", "resample": _resolved(component, "resample")})
        else:
            detail.update(
                {
                    "mode": "ranked",
                    "lookback_bars": int(_resolved(measure, "lookback_bars")) if measure else None,
                    "ordering": _resolved(rank, "direction") if rank else None,
                    "eligibility_threshold": str(_resolved(eligibility, "threshold"))
                    if eligibility
                    else None,
                }
            )
        facts.append(
            SemanticFact(
                id=f"selection:{component.id}",
                category=SemanticCategory.SELECTION,
                kind="ranked_selection" if rank else "random_selection",
                label=f"Choose {detail['count']} {'strongest' if rank else 'random'}",
                ref=_ref(component, SemanticCategory.SELECTION, *related, field="config.count"),
                detail=detail,
            )
        )
    for component in strategy.graph.components:
        primitive = component.primitive
        if primitive == "asset_set@1":
            definition_id = str(_resolved(component, "asset_set_ref"))
            definition = definitions[definition_id]
            facts.append(
                SemanticFact(
                    id=f"universe:{component.id}",
                    category=SemanticCategory.UNIVERSE,
                    kind="asset_set",
                    label=", ".join(definition.assets),
                    ref=_ref(component, SemanticCategory.UNIVERSE),
                    detail={"asset_set_id": definition.id, "assets": tuple(definition.assets)},
                )
            )
        elif primitive == "trailing_return@1":
            facts.append(
                SemanticFact(
                    id=f"measure:{component.id}",
                    category=SemanticCategory.MEASURE,
                    kind="trailing_return",
                    label=f"{_resolved(component, 'lookback_bars')}-bar trailing return",
                    ref=_ref(component, SemanticCategory.MEASURE, field="config.lookback_bars"),
                    detail={"lookback_bars": int(_resolved(component, "lookback_bars"))},
                )
            )
        elif primitive == "filter@1":
            facts.append(
                SemanticFact(
                    id=f"eligibility:{component.id}",
                    category=SemanticCategory.ELIGIBILITY,
                    kind="candidate_score_threshold",
                    label="Candidate return is above threshold",
                    ref=_ref(component, SemanticCategory.ELIGIBILITY, field="config.threshold"),
                    detail={
                        "operator": _resolved(component, "operator"),
                        "threshold": str(_resolved(component, "threshold")),
                    },
                )
            )
        elif primitive in {"daily@1", "monthly@1", "quarterly@1"}:
            facts.append(
                SemanticFact(
                    id=f"timing:{component.id}",
                    category=SemanticCategory.TIMING,
                    kind=primitive.removesuffix("@1"),
                    label=primitive.removesuffix("@1").title(),
                    ref=_ref(component, SemanticCategory.TIMING),
                    detail=dict(component.config),
                )
            )
        elif primitive == "equal_weight@1":
            facts.append(
                SemanticFact(
                    id=f"allocation:{component.id}",
                    category=SemanticCategory.ALLOCATION,
                    kind="equal_weight",
                    label=f"Equal weight ({_resolved(component, 'total')})",
                    ref=_ref(component, SemanticCategory.ALLOCATION, field="config.total"),
                    detail={"total": str(_resolved(component, "total"))},
                )
            )
        elif primitive == "cooldown@1":
            facts.append(
                SemanticFact(
                    id=f"constraint:{component.id}",
                    category=SemanticCategory.CONSTRAINT,
                    kind="cooldown",
                    label=f"Cooldown {_resolved(component, 'duration')} trading days",
                    ref=_ref(component, SemanticCategory.CONSTRAINT, field="config.duration"),
                    detail={
                        "duration": int(_resolved(component, "duration")),
                        "unit": _resolved(component, "unit"),
                    },
                )
            )
        elif primitive == "fallback@1":
            asset_set_id = str(_resolved(component, "fallback_asset_set_ref"))
            facts.append(
                SemanticFact(
                    id=f"selection-fallback:{component.id}",
                    category=SemanticCategory.SELECTION,
                    kind="selection_fallback",
                    label=f"Selection fallback to {', '.join(definitions[asset_set_id].assets)}",
                    ref=_ref(component, SemanticCategory.SELECTION),
                    detail={"asset_set_id": asset_set_id, "assets": tuple(definitions[asset_set_id].assets)},
                )
            )
        elif primitive in {"portfolio@1", "portfolio_sleeve@1", "merge_targets@1"}:
            kind = {"portfolio@1": "portfolio", "portfolio_sleeve@1": "sleeve", "merge_targets@1": "merge"}[
                primitive
            ]
            facts.append(
                SemanticFact(
                    id=f"portfolio:{component.id}",
                    category=SemanticCategory.PORTFOLIO,
                    kind=kind,
                    label=str(component.config.get("name", kind.title())),
                    ref=_ref(component, SemanticCategory.PORTFOLIO),
                    detail=dict(component.config),
                )
            )
        elif primitive == "rebalance@1":
            facts.append(
                SemanticFact(
                    id=f"action:{component.id}",
                    category=SemanticCategory.ACTION,
                    kind="rebalance",
                    label="Rebalance portfolio",
                    ref=_ref(component, SemanticCategory.ACTION),
                )
            )
        elif primitive == "rule@1":
            if component.condition is not None:
                label = "Rule predicate"
                detail = {"expression": component.condition.model_dump(mode="json")}
                if (
                    isinstance(component.condition, ComparisonExpression)
                    and isinstance(component.condition.left, IndicatorExpression)
                    and isinstance(component.condition.left.asset, LiteralExpression)
                    and isinstance(component.condition.right, LiteralExpression)
                ):
                    operator = {"gt": ">", "gte": "≥", "lt": "<", "lte": "≤"}.get(
                        component.condition.operator, component.condition.operator
                    )
                    asset = str(component.condition.left.asset.value)
                    lookback = int(component.condition.left.parameters.get("lookback_bars", 0))
                    threshold = str(component.condition.right.value)
                    label = f"IF {asset} {lookback}-bar return {operator} {threshold}"
                    detail.update(
                        {
                            "asset": asset,
                            "measure": "trailing_return",
                            "lookback_bars": lookback,
                            "operator": component.condition.operator,
                            "threshold": threshold,
                        }
                    )
                facts.append(
                    SemanticFact(
                        id=f"predicate:{component.id}",
                        category=SemanticCategory.PREDICATE,
                        kind="control_predicate",
                        label=label,
                        ref=_ref(component, SemanticCategory.PREDICATE, field="condition"),
                        detail=detail,
                    )
                )
            for branch, branch_actions in (("then", component.actions), ("otherwise", component.else_actions)):
                field_name = "actions" if branch == "then" else "else_actions"
                for index, action in enumerate(branch_actions):
                    facts.append(
                        SemanticFact(
                            id=(
                                f"action:{component.id}:{index}"
                                if branch == "then"
                                else f"action:{component.id}:otherwise:{index}"
                            ),
                            category=SemanticCategory.ACTION,
                            kind=action.kind,
                            label=action.kind.replace("_", " ").title(),
                            ref=_ref(component, SemanticCategory.ACTION, field=f"{field_name}[{index}]"),
                            detail={"action": action.model_dump(mode="json"), "branch": branch},
                        )
                    )
    for definition in strategy.definitions.state:
        facts.append(
            SemanticFact(
                id=f"state:{definition.id}",
                category=SemanticCategory.STATE,
                kind="state_definition",
                label=definition.id,
                ref=SemanticProjectionRef(definition_id=definition.id, semantic_role=SemanticCategory.STATE),
                detail={"value_type": definition.value_type.value, "initial": definition.initial},
            )
        )
    return facts


def _flow_projection(strategy: CanonicalStrategyV1, facts: list[SemanticFact]) -> FlowSemanticProjection:
    graph = _Graph(strategy)
    units: list[FlowSemanticUnit] = []
    placements: list[FactPlacement] = []
    unit_by_component: dict[str, str] = {}
    family_for = {
        SemanticCategory.UNIVERSE: "entity",
        SemanticCategory.PORTFOLIO: "entity",
        SemanticCategory.ALLOCATION: "distribution",
        SemanticCategory.SELECTION: "routing",
        SemanticCategory.ACTION: "action",
        SemanticCategory.TIMING: "timing_annotation",
    }
    primary_categories = set(family_for)
    for fact in facts:
        if fact.category in primary_categories and fact.kind not in {"random_selection", "ranked_selection"}:
            if fact.category == SemanticCategory.SELECTION and fact.kind == "selection_fallback":
                family = "routing"
            else:
                family = family_for[fact.category]
            unit = FlowSemanticUnit(
                id=f"flow:{fact.id}",
                family=family,
                kind=fact.kind,
                label=fact.label,
                ref=fact.ref,
                fact_ids=(fact.id,),
            )
            units.append(unit)
            if fact.ref.primary_component_id:
                unit_by_component[fact.ref.primary_component_id] = unit.id
            placements.append(
                FactPlacement(
                    fact_id=fact.id, placement=InformationPlacement.PRIMARY_VISIBLE, unit_id=unit.id
                )
            )
        elif fact.kind in {"random_selection", "ranked_selection"}:
            unit = FlowSemanticUnit(
                id=f"flow:{fact.id}",
                family="routing",
                kind="selection_routing",
                label=fact.label,
                ref=fact.ref,
                fact_ids=(fact.id,),
            )
            units.append(unit)
            unit_by_component[fact.ref.primary_component_id or ""] = unit.id
            placements.append(
                FactPlacement(
                    fact_id=fact.id, placement=InformationPlacement.PRIMARY_VISIBLE, unit_id=unit.id
                )
            )
        else:
            placement = InformationPlacement.INSPECTOR_DETAIL
            if fact.category in {
                SemanticCategory.MEASURE,
                SemanticCategory.ELIGIBILITY,
                SemanticCategory.PREDICATE,
            }:
                placement = InformationPlacement.COMPRESSED_RECOVERABLE
            elif fact.category == SemanticCategory.STATE:
                placement = InformationPlacement.NOT_MEANINGFUL
            placements.append(FactPlacement(fact_id=fact.id, placement=placement))
    edges: list[FlowSemanticEdge] = []
    component_by_unit = {unit_id: component_id for component_id, unit_id in unit_by_component.items()}
    for target_unit, target_component in component_by_unit.items():
        upstream = graph.ancestors(target_component)
        candidates = {
            source_unit: source_component
            for source_unit, source_component in component_by_unit.items()
            if source_unit != target_unit and source_component in upstream
        }
        nearest = {
            source_unit
            for source_unit, source_component in candidates.items()
            if not any(
                source_component in graph.ancestors(other_component)
                for other_unit, other_component in candidates.items()
                if other_unit != source_unit
            )
        }
        edges.extend(
            FlowSemanticEdge(source_unit_id=source_unit, target_unit_id=target_unit, kind="capital")
            for source_unit in nearest
        )
    return FlowSemanticProjection(
        units=tuple(units), edges=tuple(dict.fromkeys(edges)), placements=tuple(placements)
    )


def _logic_projection(
    strategy: CanonicalStrategyV1, graph: _Graph, facts: list[SemanticFact]
) -> LogicSemanticProjection:
    facts_by_component: dict[str, list[SemanticFact]] = defaultdict(list)
    for fact in facts:
        if fact.ref.primary_component_id:
            facts_by_component[fact.ref.primary_component_id].append(fact)
    scripts: list[LogicScript] = []
    context_scripts: dict[str, list[str]] = defaultdict(list)
    context_components: dict[str, Component] = {}
    sleeves = {item.id: item for item in strategy.graph.components if item.primitive == "portfolio_sleeve@1"}
    portfolio = next((item for item in strategy.graph.components if item.primitive == "portfolio@1"), None)
    for index, entrypoint in enumerate(strategy.entrypoints):
        event = graph.components[entrypoint.event_component_id]
        target = graph.components[entrypoint.target_component_id]
        scope_ids = graph.ancestors(target.id) | {target.id}
        sleeve = (
            target
            if target.id in sleeves
            else next((item for item in sleeves.values() if item.id in scope_ids), None)
        )
        context_component = (
            portfolio if target.primitive == "rebalance@1" and portfolio else sleeve or portfolio or target
        )
        context_id = f"context:{context_component.id}"
        context_components[context_id] = context_component
        semantic_facts = [fact for fact in facts if fact.ref.primary_component_id in scope_ids]
        statements: list[LogicStatement] = []
        selections = [
            fact for fact in semantic_facts if fact.kind in {"ranked_selection", "random_selection"}
        ]
        for selection in selections:
            related_components = {selection.ref.primary_component_id, *selection.ref.related_component_ids}
            related_fact_ids = tuple(
                fact.id
                for fact in semantic_facts
                if fact.ref.primary_component_id in related_components
                and fact.category
                in {SemanticCategory.UNIVERSE, SemanticCategory.MEASURE, SemanticCategory.ELIGIBILITY}
            )
            modifiers = tuple(
                fact.id
                for fact in semantic_facts
                if fact.category == SemanticCategory.CONSTRAINT or fact.kind == "selection_fallback"
            )
            statements.append(
                LogicStatement(
                    id=f"statement:{selection.id}",
                    family="selection",
                    kind=selection.kind,
                    label=selection.label,
                    ref=selection.ref,
                    fact_ids=(selection.id, *related_fact_ids),
                    modifier_fact_ids=modifiers,
                )
            )
        predicates = [fact for fact in semantic_facts if fact.category == SemanticCategory.PREDICATE]
        actions = [fact for fact in semantic_facts if fact.category == SemanticCategory.ACTION]
        for predicate in predicates:
            then_action_ids = tuple(
                f"statement:{item.id}" for item in actions if item.detail.get("branch") == "then"
            )
            else_action_ids = tuple(
                f"statement:{item.id}" for item in actions if item.detail.get("branch") == "otherwise"
            )
            statements.append(
                LogicStatement(
                    id=f"statement:{predicate.id}",
                    family="control",
                    kind="if_otherwise" if else_action_ids else "if",
                    label=predicate.label,
                    ref=predicate.ref,
                    fact_ids=(predicate.id,),
                    then_statement_ids=then_action_ids,
                    else_statement_ids=else_action_ids,
                )
            )
        allocations = [fact for fact in semantic_facts if fact.category == SemanticCategory.ALLOCATION]
        if allocations:
            first = allocations[0]
            statements.append(
                LogicStatement(
                    id=f"statement:allocation:{target.id}",
                    family="portfolio_operation",
                    kind="compound_allocation",
                    label="Allocate capital",
                    ref=first.ref,
                    fact_ids=tuple(item.id for item in allocations),
                )
            )
        for action in actions:
            statements.append(
                LogicStatement(
                    id=f"statement:{action.id}",
                    family="action",
                    kind=action.kind,
                    label=action.label,
                    ref=action.ref,
                    fact_ids=(action.id,),
                )
            )
        trigger_fact = next(
            item for item in facts_by_component[event.id] if item.category == SemanticCategory.TIMING
        )
        script_id = f"script:{entrypoint.event_component_id}:{entrypoint.target_component_id}:{index}"
        scripts.append(
            LogicScript(
                id=script_id,
                context_id=context_id,
                trigger=LogicTrigger(timing_fact_id=trigger_fact.id, ref=trigger_fact.ref),
                statements=tuple(statements),
            )
        )
        context_scripts[context_id].append(script_id)
    for component in (*sleeves.values(), *((portfolio,) if portfolio else ())):
        context_id = f"context:{component.id}"
        context_components.setdefault(context_id, component)
        context_scripts.setdefault(context_id, [])
    contexts = tuple(
        LogicContext(
            id=context_id,
            kind="sleeve"
            if component.primitive == "portfolio_sleeve@1"
            else "portfolio"
            if component.primitive == "portfolio@1"
            else "investment",
            label=str(component.config.get("name", strategy.metadata.name)),
            ref=_ref(
                component,
                SemanticCategory.PORTFOLIO
                if component.primitive in {"portfolio@1", "portfolio_sleeve@1"}
                else SemanticCategory.ACTION,
            ),
            fact_ids=tuple(
                fact.id
                for fact in facts
                if fact.ref.primary_component_id == component.id
                or (
                    fact.category == SemanticCategory.UNIVERSE
                    and fact.ref.primary_component_id in graph.ancestors(component.id)
                )
            ),
            script_ids=tuple(script_ids),
        )
        for context_id, script_ids in context_scripts.items()
        for component in (context_components[context_id],)
    )
    used = {
        fact_id
        for script in scripts
        for statement in script.statements
        for fact_id in (*statement.fact_ids, *statement.modifier_fact_ids)
    }
    used.update(script.trigger.timing_fact_id for script in scripts)
    placements = tuple(
        FactPlacement(
            fact_id=fact.id,
            placement=InformationPlacement.PRIMARY_VISIBLE
            if fact.id in used
            and fact.category
            in {
                SemanticCategory.SELECTION,
                SemanticCategory.PREDICATE,
                SemanticCategory.ACTION,
                SemanticCategory.TIMING,
            }
            else InformationPlacement.INSPECTOR_DETAIL
            if fact.id in used
            else InformationPlacement.COMPRESSED_RECOVERABLE
            if fact.category
            in {SemanticCategory.PORTFOLIO, SemanticCategory.ALLOCATION, SemanticCategory.CONSTRAINT}
            else InformationPlacement.PRIMARY_VISIBLE
            if fact.category == SemanticCategory.UNIVERSE
            else InformationPlacement.NOT_MEANINGFUL,
        )
        for fact in facts
    )
    return LogicSemanticProjection(contexts=contexts, scripts=tuple(scripts), placements=placements)


def project_semantic_composition(strategy: CanonicalStrategyV1) -> SemanticCompositionProjection:
    graph = _Graph(strategy)
    facts = _component_facts(strategy, graph)
    return SemanticCompositionProjection(
        facts=tuple(facts),
        flow=_flow_projection(strategy, facts),
        logic=_logic_projection(strategy, graph, facts),
    )


class ConfigureSelectionIntent(FrozenModel):
    kind: Literal["configure_selection"] = "configure_selection"
    selection_component_id: Identifier
    count: Annotated[int, Field(ge=1)]
    measure_component_id: Identifier | None = None
    lookback_bars: Annotated[int, Field(ge=1)] | None = None


class ConfigureEligibilityIntent(FrozenModel):
    kind: Literal["configure_eligibility"] = "configure_eligibility"
    eligibility_component_id: Identifier
    threshold: Decimal


class ConfigurePredicateIntent(FrozenModel):
    kind: Literal["configure_predicate"] = "configure_predicate"
    predicate_component_id: Identifier


class ConfigureAllocationIntent(FrozenModel):
    kind: Literal["configure_allocation"] = "configure_allocation"
    allocations: Annotated[tuple[SleeveAllocationInput, ...], Field(min_length=2, max_length=2)]


class ConfigureConstraintIntent(FrozenModel):
    kind: Literal["configure_constraint"] = "configure_constraint"
    constraint_component_id: Identifier
    duration: Annotated[int, Field(ge=1)]


class ConfigureTimingIntent(FrozenModel):
    kind: Literal["configure_timing"] = "configure_timing"
    timing_component_id: Identifier
    cadence: Literal["daily", "monthly", "quarterly"]
    day: Literal[1] | None = None


class AttachFallbackIntent(FrozenModel):
    kind: Literal["attach_fallback"] = "attach_fallback"
    allocation_component_id: Identifier
    fallback_asset: Symbol


class CreatePortfolioSplitIntent(FrozenModel):
    kind: Literal["create_portfolio_split"] = "create_portfolio_split"
    target_component_id: Identifier
    growth_allocation: Annotated[Decimal, Field(gt=0, lt=1)]
    defensive_assets: Annotated[tuple[Symbol, ...], Field(min_length=1)]


SemanticAuthoringIntent = Annotated[
    ConfigureSelectionIntent
    | ConfigureEligibilityIntent
    | ConfigurePredicateIntent
    | ConfigureAllocationIntent
    | ConfigureConstraintIntent
    | ConfigureTimingIntent
    | AttachFallbackIntent
    | CreatePortfolioSplitIntent,
    Field(discriminator="kind"),
]


class ApplySemanticIntentRequest(FrozenModel):
    strategy: CanonicalStrategyV1
    intent: SemanticAuthoringIntent


class ApplySemanticIntentResponse(FrozenModel):
    strategy: CanonicalStrategyV1
    projection: SemanticCompositionProjection


class SemanticIntentError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def resolve_semantic_intent(intent: SemanticAuthoringIntent) -> StructuralAuthoringOperation:
    if isinstance(intent, ConfigureSelectionIntent):
        if intent.lookback_bars is None:
            return UpdateSelectionCountOperation(
                component_id=intent.selection_component_id, count=intent.count
            )
        if intent.measure_component_id is None:
            raise SemanticIntentError(
                "missing_measure_target", "Lookback editing requires an exact Measure target."
            )
        return ComposeStrategyOperation(
            mutations=(
                SetComponentFieldMutation(
                    target=ComponentAddress(component_id=intent.selection_component_id),
                    field="count",
                    value=intent.count,
                ),
                SetComponentFieldMutation(
                    target=ComponentAddress(component_id=intent.measure_component_id),
                    field="lookback_bars",
                    value=intent.lookback_bars,
                ),
            )
        )
    if isinstance(intent, ConfigureEligibilityIntent):
        return UpdateQualificationThresholdOperation(
            component_id=intent.eligibility_component_id, threshold=intent.threshold
        )
    if isinstance(intent, ConfigurePredicateIntent):
        raise SemanticIntentError(
            "predicate_authoring_deferred",
            "Current executable authoring does not support control predicates.",
        )
    if isinstance(intent, ConfigureAllocationIntent):
        return UpdateSleeveAllocationsOperation(allocations=intent.allocations)
    if isinstance(intent, ConfigureConstraintIntent):
        return UpdateCooldownDurationOperation(
            component_id=intent.constraint_component_id, duration=intent.duration
        )
    if isinstance(intent, ConfigureTimingIntent):
        return UpdateScheduleOperation(
            component_id=intent.timing_component_id, cadence=intent.cadence, day=intent.day
        )
    if isinstance(intent, AttachFallbackIntent):
        return AddFallbackSelectionOperation(
            weight_component_id=intent.allocation_component_id, fallback_asset=intent.fallback_asset
        )
    return TransformToGrowthDefensiveOperation(
        target_component_id=intent.target_component_id,
        growth_allocation=intent.growth_allocation,
        defensive_assets=intent.defensive_assets,
    )


def apply_semantic_intent(
    strategy: CanonicalStrategyV1, intent: SemanticAuthoringIntent
) -> CanonicalStrategyV1:
    if isinstance(intent, ConfigureSelectionIntent):
        candidate = apply_structural_operation(
            strategy,
            UpdateSelectionCountOperation(component_id=intent.selection_component_id, count=intent.count),
        )
        if intent.lookback_bars is not None:
            if intent.measure_component_id is None:
                raise SemanticIntentError(
                    "missing_measure_target", "Lookback editing requires an exact Measure target."
                )
            candidate = apply_structural_operation(
                candidate,
                UpdateLookbackOperation(
                    component_id=intent.measure_component_id,
                    lookback_bars=intent.lookback_bars,
                ),
            )
        return candidate
    return apply_structural_operation(strategy, resolve_semantic_intent(intent))
