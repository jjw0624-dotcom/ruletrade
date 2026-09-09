from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

DECISION_EVIDENCE_SCHEMA_VERSION = 1


class EvidenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceComponentRef(EvidenceModel):
    role: str
    component_id: str


class AssetPredicate(EvidenceModel):
    asset: str
    observed: Decimal
    passed: bool


class FilterEvidence(EvidenceModel):
    kind: Literal["filter"] = "filter"
    operator: Literal["gt"]
    threshold: Decimal
    evaluations: tuple[AssetPredicate, ...]


class SelectionEvidence(EvidenceModel):
    kind: Literal["selection"] = "selection"
    scores: dict[str, Decimal]
    ranked: tuple[str, ...]
    candidates: tuple[str, ...]
    primary_selected: tuple[str, ...]
    decision: Literal["executed", "insufficient", "skipped", "signal"]


class RandomSelectionEvidence(EvidenceModel):
    kind: Literal["random_selection"] = "random_selection"
    universe: tuple[str, ...]
    selected: tuple[str, ...]
    resample: Literal["once", "per_event"]


class FallbackEvidence(EvidenceModel):
    kind: Literal["fallback"] = "fallback"
    asset: str
    activated: bool


class FinalSelectionEvidence(EvidenceModel):
    kind: Literal["final_selection"] = "final_selection"
    selected: tuple[str, ...]
    source: Literal["primary", "fallback"]


class CooldownEvidence(EvidenceModel):
    kind: Literal["cooldown"] = "cooldown"
    asset: str
    signal_candidate: bool
    last_exit: date | None
    elapsed_completed_sessions: int | None
    required_completed_sessions: int
    eligible: bool


class StateMutationEvidence(EvidenceModel):
    kind: Literal["state_mutation"] = "state_mutation"
    asset: str
    state: Literal["last_exit"]
    old_value: date | None
    new_value: date
    cause: Literal["target_exit"]


class SnapshotRefreshEvidence(EvidenceModel):
    kind: Literal["snapshot_refresh"] = "snapshot_refresh"
    schedule: Literal["monthly", "quarterly"]
    local_targets: dict[str, Decimal]
    snapshot_session: date


class SnapshotUsageEvidence(EvidenceModel):
    kind: Literal["snapshot_usage"] = "snapshot_usage"
    schedule: Literal["monthly", "quarterly"]
    snapshots: dict[str, date]
    executed: bool


class SleeveContributionEvidence(EvidenceModel):
    kind: Literal["sleeve_contribution"] = "sleeve_contribution"
    local_selected: tuple[str, ...]
    local_targets: dict[str, Decimal]
    allocation: Decimal
    scaled_targets: dict[str, Decimal]


class FinalTargetsEvidence(EvidenceModel):
    kind: Literal["final_targets"] = "final_targets"
    selected: tuple[str, ...]
    targets: dict[str, Decimal]


DecisionEvidence = Annotated[
    FilterEvidence
    | SelectionEvidence
    | RandomSelectionEvidence
    | FallbackEvidence
    | FinalSelectionEvidence
    | CooldownEvidence
    | StateMutationEvidence
    | SnapshotRefreshEvidence
    | SnapshotUsageEvidence
    | SleeveContributionEvidence
    | FinalTargetsEvidence,
    Field(discriminator="kind"),
]


class CollectedDecisionEvent(EvidenceModel):
    sequence: int = Field(ge=1)
    session_id: date
    phase: Literal[
        "evaluation",
        "selection",
        "snapshot_commit",
        "portfolio_execution",
        "state_mutation",
    ]
    source_components: tuple[SourceComponentRef, ...]
    evidence: DecisionEvidence


class DecisionEventSummary(EvidenceModel):
    id: str
    run_id: str
    ordinal: int = Field(ge=1)
    schema_version: Literal[1] = DECISION_EVIDENCE_SCHEMA_VERSION
    session_id: date
    phase: Literal[
        "evaluation",
        "selection",
        "snapshot_commit",
        "portfolio_execution",
        "state_mutation",
    ]
    kind: Literal[
        "filter",
        "selection",
        "random_selection",
        "fallback",
        "final_selection",
        "cooldown",
        "state_mutation",
        "snapshot_refresh",
        "snapshot_usage",
        "sleeve_contribution",
        "final_targets",
    ]
    source_components: tuple[SourceComponentRef, ...]


class DecisionEventDetail(DecisionEventSummary):
    evidence: DecisionEvidence


class DecisionEventList(EvidenceModel):
    items: list[DecisionEventSummary]
