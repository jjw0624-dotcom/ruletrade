from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

DECISION_EVIDENCE_SCHEMA_VERSION = 2


class EvidenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceComponentRef(EvidenceModel):
    role: str
    component_id: str
    field_path: Annotated[
        str,
        Field(pattern=r"^config\.[a-z][a-z0-9_]*$"),
    ] | None = None


class AssetPredicate(EvidenceModel):
    asset: str
    observed: Decimal
    passed: bool
    stopping_stage: Literal["filter"] | None = None


class FilterEvidence(EvidenceModel):
    kind: Literal["filter"] = "filter"
    operator: Literal["gt"]
    threshold: Decimal
    evaluations: tuple[AssetPredicate, ...]
    decision_universe: tuple[str, ...] | None = None


class SelectionAssetOutcome(EvidenceModel):
    asset: str
    evaluated: Literal[True] = True
    signal: Literal["present", "absent"]
    rank: int = Field(ge=1)
    primary_selected: bool
    stopping_stage: Literal[
        "rank_cutoff",
        "primary_selection_incomplete",
        "fallback_replacement",
    ] | None = None


class SelectionEvidence(EvidenceModel):
    kind: Literal["selection"] = "selection"
    scores: dict[str, Decimal]
    ranked: tuple[str, ...]
    candidates: tuple[str, ...]
    primary_selected: tuple[str, ...]
    decision: Literal["executed", "insufficient", "skipped", "signal"]
    required_count: int | None = Field(default=None, ge=1)
    asset_outcomes: tuple[SelectionAssetOutcome, ...] | None = None


class RandomSelectionEvidence(EvidenceModel):
    kind: Literal["random_selection"] = "random_selection"
    universe: tuple[str, ...]
    selected: tuple[str, ...]
    resample: Literal["once", "per_event"]
    required_count: int | None = Field(default=None, ge=1)


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
    stopping_stage: Literal["cooldown"] | None = None


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
    schema_version: Literal[1, 2]
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
    schema_version: Literal[1, 2] = DECISION_EVIDENCE_SCHEMA_VERSION
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
