"""Validated, UI-independent perspective translation for SemanticProgramV2.

The committed Canonical document is the only strategy authority.  Perspective
manifests preserve semantic provenance but deliberately omit canvas geometry,
Blockly state and runtime/lowering diagnostics.  They are safe to derive for a
valid, execution-incomplete authoring document.
"""
from __future__ import annotations

from typing import Literal

from pydantic import model_validator

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.v2.projections import (
    ProjectionItem,
    SemanticAddress,
    project_blocky,
    project_flow,
    project_structure,
)
from ruletrade.strategy.v2.semantic_types import FrozenModel


PERSPECTIVE_SCHEMA = "ruletrade.dev/perspective-translation/v2"


class PerspectiveCapability(FrozenModel):
    representable: bool
    reference_evaluable: bool | None = None
    backend_lowerable: bool
    docker_verified: bool | None = None
    provider_supported: bool | None = None
    ui_authorable: bool
    runtime_available: bool | None = None


class PerspectiveDiagnostic(FrozenModel):
    code: str
    severity: Literal["info", "warning", "error"]
    message: str
    semantic_address: SemanticAddress | None = None


class PerspectiveObject(FrozenModel):
    id: str
    role: str
    label: str
    source_semantic_addresses: tuple[SemanticAddress, ...]
    meaning_role: Literal[
        "context", "ownership", "routing", "decision", "exposure",
        "aggregation", "realization", "calculation", "action",
    ]
    scope: str | None = None
    conditionality: Literal[
        "always", "selected", "shortage", "condition_true", "condition_false",
        "policy_winner",
    ] = "always"
    read_only: bool = False
    edit_operation: str | None = None
    capability: Literal["editable", "draft_only", "read_only", "unsupported"]
    detail: str | None = None
    abstraction_level: Literal[0, 1, 2] = 0


class CapitalFlowEdge(FrozenModel):
    id: str
    source_id: str
    target_id: str
    kind: Literal[
        "ownership_share", "conditional_target", "fallback_on_shortage",
        "target_contribution", "realization",
    ]
    source_semantic_addresses: tuple[SemanticAddress, ...] = ()
    label: str | None = None


class CapitalFlowManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/capital-flow-manifest/v2"] = (
        "ruletrade.dev/capital-flow-manifest/v2"
    )
    strategy_id: str
    semantic_fingerprint: str
    nodes: tuple[PerspectiveObject, ...]
    edges: tuple[CapitalFlowEdge, ...]
    diagnostics: tuple[PerspectiveDiagnostic, ...] = ()
    capability: PerspectiveCapability

    @model_validator(mode="after")
    def validate_graph(self) -> "CapitalFlowManifest":
        ids = [item.id for item in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate Capital Flow node identity")
        known = set(ids)
        if any(edge.source_id not in known or edge.target_id not in known for edge in self.edges):
            raise ValueError("Capital Flow contains an unknown edge endpoint")
        return self


class DecisionConnection(FrozenModel):
    id: str
    source_id: str
    target_id: str
    kind: Literal["context", "statement", "condition", "value", "fallback", "action"]
    input_name: str | None = None


class DecisionLogicManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/decision-logic-manifest/v2"] = (
        "ruletrade.dev/decision-logic-manifest/v2"
    )
    strategy_id: str
    semantic_fingerprint: str
    blocks: tuple[PerspectiveObject, ...]
    connections: tuple[DecisionConnection, ...]
    diagnostics: tuple[PerspectiveDiagnostic, ...] = ()
    capability: PerspectiveCapability

    @model_validator(mode="after")
    def validate_graph(self) -> "DecisionLogicManifest":
        ids = [item.id for item in self.blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate Decision Logic block identity")
        known = set(ids)
        if any(item.source_id not in known or item.target_id not in known for item in self.connections):
            raise ValueError("Decision Logic contains an unknown connection endpoint")
        return self


class InternalSemanticManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/internal-semantic-manifest/v2"] = (
        "ruletrade.dev/internal-semantic-manifest/v2"
    )
    strategy_id: str
    semantic_fingerprint: str
    addresses: tuple[SemanticAddress, ...]
    capability: PerspectiveCapability


class PerspectiveBundleV2(FrozenModel):
    schema_version: Literal["ruletrade.dev/perspective-translation/v2"] = PERSPECTIVE_SCHEMA
    internal: InternalSemanticManifest
    capital_flow: CapitalFlowManifest
    decision_logic: DecisionLogicManifest


def _capability(strategy: CanonicalStrategyV2) -> PerspectiveCapability:
    try:
        execution = assess_v2_execution_capability(strategy)
        lowerable = execution.execution_state == "executable"
    except Exception:  # pragma: no cover - defensive independence boundary
        # Perspective rendering remains available even if capability discovery
        # or a downstream lowerer is unavailable.  It must not claim support.
        lowerable = False
    # Runtime and Docker evidence belong to run/corpus evidence.  A projection
    # must never manufacture either merely because lowering is supported.
    advanced_kinds = {
        "on_event", "transition", "remember_value", "guarded_allocation",
        "clocked_value", "score", "n_of_m", "inverse_volatility",
    }

    def kinds(value: object) -> set[str]:
        if isinstance(value, dict):
            found = {value["kind"]} if isinstance(value.get("kind"), str) else set()
            return found | set().union(*(kinds(item) for item in value.values()))
        if isinstance(value, (list, tuple)):
            return set().union(*(kinds(item) for item in value))
        return set()

    ui_authorable = not bool(kinds(strategy.model_dump(mode="json")) & advanced_kinds)
    return PerspectiveCapability(
        representable=True,
        backend_lowerable=lowerable,
        ui_authorable=ui_authorable,
    )


def _object_capability(item: ProjectionItem) -> tuple[bool, str | None, Literal["editable", "read_only"]]:
    operations = {
        "investment": "remove_program_investment",
        "assets": "set_program_asset_set",
        "split": "set_program_split",
        "selection": "set_program_selection",
        "fallback": "set_program_fallback",
        "allocation": "set_program_allocation",
        "control": "set_program_condition",
        "event": "set_program_event",
        "transition": "set_program_transition",
        "memory": "set_program_value",
        "policy": "set_program_allocation",
        "condition": "set_program_condition",
        "value": "set_program_value",
        "rebalance": "set_program_schedule",
    }
    operation = operations.get(item.role)
    return operation is None, operation, "read_only" if operation is None else "editable"


def _meaning_role(role: str, *, flow: bool) -> PerspectiveObject.__annotations__["meaning_role"]:
    if role in {"portfolio"}:
        return "context"
    if role in {"investment"}:
        return "ownership"
    if role in {"split", "selection", "control", "event", "policy"}:
        return "routing" if flow else "decision"
    if role in {"destination", "fallback"}:
        return "exposure"
    if role in {"rebalance"}:
        return "realization"
    if role in {"condition", "value", "memory", "transition"}:
        return "calculation"
    if role in {"allocation"}:
        return "aggregation" if flow else "action"
    return "action"


def _perspective_object(item: ProjectionItem, *, flow: bool) -> PerspectiveObject:
    read_only, operation, capability = _object_capability(item)
    conditionality: PerspectiveObject.__annotations__["conditionality"] = "always"
    if item.route == "selected":
        conditionality = "selected"
    elif item.route == "fallback":
        conditionality = "shortage"
    return PerspectiveObject(
        id=item.id,
        role=item.role,
        label=item.label,
        detail=item.detail,
        source_semantic_addresses=(item.address,),
        meaning_role=_meaning_role(item.role, flow=flow),
        scope=item.parent_id,
        conditionality=conditionality,
        read_only=read_only,
        edit_operation=operation,
        capability=capability,
        abstraction_level=0 if item.role not in {"condition", "value"} else 1,
    )


def derive_capital_flow(strategy: CanonicalStrategyV2) -> CapitalFlowManifest:
    projection = project_flow(strategy)
    route_kind = {
        "contains": "ownership_share",
        "capital": "ownership_share",
        "selected": "conditional_target",
        "fallback": "fallback_on_shortage",
        "action": "realization",
        "computes": "target_contribution",
    }
    by_id = {item.id: item for item in projection.items}
    edges = tuple(CapitalFlowEdge(
        id=f"flow-edge:{link.source_id}->{link.target_id}:{link.route}",
        source_id=link.source_id,
        target_id=link.target_id,
        kind=route_kind[link.route],
        label=link.label,
        source_semantic_addresses=tuple(dict.fromkeys((
            by_id[link.source_id].address,
            by_id[link.target_id].address,
        ))),
    ) for link in projection.links)
    return CapitalFlowManifest(
        strategy_id=projection.strategy_id,
        semantic_fingerprint=strategy_hash(strategy),
        nodes=tuple(_perspective_object(item, flow=True) for item in projection.items),
        edges=edges,
        capability=_capability(strategy),
    )


def derive_decision_logic(strategy: CanonicalStrategyV2) -> DecisionLogicManifest:
    projection = project_blocky(strategy)
    blocks = tuple(_perspective_object(item, flow=False) for item in projection.items)
    connections: list[DecisionConnection] = []
    for item in projection.items:
        if item.parent_id is None:
            continue
        kind: DecisionConnection.__annotations__["kind"] = "statement"
        if item.role == "condition":
            kind = "condition"
        elif item.role == "value":
            kind = "value"
        elif item.role == "fallback":
            kind = "fallback"
        elif item.parent_id.startswith("blocky:context:"):
            kind = "context"
        connections.append(DecisionConnection(
            id=f"logic-connection:{item.parent_id}->{item.id}",
            source_id=item.parent_id,
            target_id=item.id,
            kind=kind,
        ))
    return DecisionLogicManifest(
        strategy_id=projection.strategy_id,
        semantic_fingerprint=strategy_hash(strategy),
        blocks=blocks,
        connections=tuple(connections),
        capability=_capability(strategy),
    )


def perspective_bundle(strategy: CanonicalStrategyV2) -> PerspectiveBundleV2:
    structure = project_structure(strategy)
    flow = derive_capital_flow(strategy)
    logic = derive_decision_logic(strategy)
    addresses = tuple(dict.fromkeys(
        item.address
        for manifest in (structure, project_flow(strategy), project_blocky(strategy))
        for item in manifest.items
    ))
    internal = InternalSemanticManifest(
        strategy_id=structure.strategy_id,
        semantic_fingerprint=strategy_hash(strategy),
        addresses=addresses,
        capability=_capability(strategy),
    )
    return PerspectiveBundleV2(internal=internal, capital_flow=flow, decision_logic=logic)


def semantically_equivalent(left: CanonicalStrategyV2, right: CanonicalStrategyV2) -> bool:
    """Compare committed meaning; layout/presentation never participates."""
    return strategy_hash(left) == strategy_hash(right)
