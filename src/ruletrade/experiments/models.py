from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.backtest_runs.models import BacktestRunRecord
from ruletrade.experiments.hidden_policies import HiddenDatasetPolicy
from ruletrade.experiments.test_policies import RobustnessPolicy
from ruletrade.strategy.v2.catalog import CreateCatalogStrategyRequest
from ruletrade.strategy.v2.models import CanonicalStrategyV2


class ExperimentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ResearchExperimentKind(str, Enum):
    DETAIL = "detail"
    HIDDEN = "hidden"
    ROBUSTNESS = "robustness"
    RANDOM_BASELINE = "random_baseline"
    FORWARD = "forward"


class ParameterDimension(ExperimentModel):
    parameter_id: str = Field(min_length=1)
    values: tuple[Any, ...] = Field(min_length=1, max_length=32)


class CreateDetailExperimentRequest(BaseModel):
    """One high-fidelity run of the unchanged saved Revision."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)


class CreateHiddenExperimentRequest(BaseModel):
    """Tune catalog parameters on calibration data, then evaluate the winner once."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    policy_id: str = Field(min_length=1, max_length=100)
    base: CreateCatalogStrategyRequest
    dimensions: tuple[ParameterDimension, ...] = Field(min_length=1, max_length=8)


class CreateRobustnessExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    policy_id: str = Field(default="start-date-offset-v1", min_length=1, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)


class CreateRandomBaselineExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    base: CreateCatalogStrategyRequest
    seeds: tuple[int, ...] = Field(min_length=1, max_length=8)
    config: dict[str, Any] = Field(default_factory=dict)


class CreateForwardExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    start_date: date
    initial_cash: Decimal = Field(gt=0)
    dataset_id: str = Field(min_length=1, max_length=100)


class ExperimentCandidateRecord(ExperimentModel):
    id: str
    experiment_id: str
    ordinal: int = Field(ge=1)
    parameters: dict[str, Any]
    canonical_strategy: CanonicalStrategyV2
    source_hash: str
    run_id: str | None = None
    created_at: datetime


class ResearchExperimentRecord(ExperimentModel):
    id: str
    revision_id: str
    kind: ResearchExperimentKind
    name: str
    spec: dict[str, Any]
    candidates: tuple[ExperimentCandidateRecord, ...]
    created_at: datetime


class DetailExperimentExecution(ExperimentModel):
    experiment: ResearchExperimentRecord
    runs: tuple[BacktestRunRecord, ...]


class HiddenExperimentExecution(ExperimentModel):
    experiment: ResearchExperimentRecord
    policy: HiddenDatasetPolicy
    calibration_runs: tuple[BacktestRunRecord, ...]
    selected_candidate_ordinal: int = Field(ge=1)
    hidden_run: BacktestRunRecord
    generalization_gap: Decimal | None = None


class ForwardExperimentExecution(ExperimentModel):
    experiment: ResearchExperimentRecord
    latest_run: BacktestRunRecord


class TestExperimentExecution(ExperimentModel):
    experiment: ResearchExperimentRecord
    runs: tuple[BacktestRunRecord, ...]


class RobustnessPolicyList(ExperimentModel):
    items: tuple[RobustnessPolicy, ...]


class HiddenDatasetPolicyList(ExperimentModel):
    items: tuple[HiddenDatasetPolicy, ...]


class ResearchExperimentList(ExperimentModel):
    items: tuple[ResearchExperimentRecord, ...]
