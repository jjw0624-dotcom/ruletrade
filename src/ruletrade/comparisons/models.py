from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.decision_evidence.models import DecisionEventDetail

COMPARISON_SCHEMA_VERSION = 1

BehaviorDifferenceKind = Literal[
    "event_presence_changed",
    "qualification_changed",
    "rank_changed",
    "candidate_membership_changed",
    "primary_selection_changed",
    "fallback_activation_changed",
    "cooldown_eligibility_changed",
    "final_selection_changed",
    "snapshot_targets_changed",
    "snapshot_usage_changed",
    "sleeve_contribution_changed",
    "state_mutation_changed",
    "final_target_changed",
]


class ComparisonModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ComparisonDiagnostics(ComparisonModel):
    artifact_load_ms: int = Field(default=0, ge=0)
    comparability_validation_ms: int = Field(default=0, ge=0)
    evidence_load_ms: int = Field(default=0, ge=0)
    alignment_ms: int = Field(default=0, ge=0)
    result_diff_ms: int = Field(default=0, ge=0)
    persistence_ms: int = Field(default=0, ge=0)
    total_ms: int = Field(default=0, ge=0)
    comparison_bytes: int = Field(default=0, ge=0)


class StrategyDiff(ComparisonModel):
    component_id: str
    field_path: str
    before: Decimal
    after: Decimal


class BehaviorDifference(ComparisonModel):
    key: str
    presence: Literal["both", "original_only", "candidate_only"]
    kinds: tuple[BehaviorDifferenceKind, ...]
    original_event: DecisionEventDetail | None
    candidate_event: DecisionEventDetail | None


class DecisionContextDiff(ComparisonModel):
    session_id: date
    differences: tuple[BehaviorDifference, ...]


class FirstDifference(ComparisonModel):
    session_id: date
    difference_key: str


class DecimalMetricDiff(ComparisonModel):
    original: Decimal
    candidate: Decimal
    delta: Decimal


class IntegerMetricDiff(ComparisonModel):
    original: int
    candidate: int
    delta: int


class ResultDiff(ComparisonModel):
    initial_value: DecimalMetricDiff
    final_value: DecimalMetricDiff
    total_return: DecimalMetricDiff
    total_orders: IntegerMetricDiff
    total_fees: DecimalMetricDiff
    original_equity_run_id: str
    candidate_equity_run_id: str


class ComparisonRecord(ComparisonModel):
    schema_version: Literal[1] = COMPARISON_SCHEMA_VERSION
    id: str
    candidate_id: str
    original_run_id: str
    candidate_run_id: str
    strategy_diff: StrategyDiff
    aligned_evidence_records: int
    changed_decision_contexts: tuple[DecisionContextDiff, ...]
    first_difference: FirstDifference | None
    result_diff: ResultDiff
    compute_ms: int = Field(ge=0)
    created_at: datetime
    diagnostics: ComparisonDiagnostics = Field(default_factory=ComparisonDiagnostics)
