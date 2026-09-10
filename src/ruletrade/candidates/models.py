from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.backtest_runs.models import BacktestRunRecord
from ruletrade.strategy.v1.models import CanonicalStrategyV1


class CandidateModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FilterThresholdChange(CandidateModel):
    kind: Literal["filter_threshold"] = "filter_threshold"
    component_id: Annotated[str, Field(min_length=1)]
    field_path: Literal["config.threshold"] = "config.threshold"
    expected_before: Decimal
    proposed_after: Decimal


class CreateCandidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    change: FilterThresholdChange
    originating_decision_event_id: str | None = None


class CandidateRecord(CandidateModel):
    id: str
    base_revision_id: str
    originating_run_id: str | None
    originating_decision_event_id: str | None
    change: FilterThresholdChange
    canonical_strategy: CanonicalStrategyV1
    source_hash: str
    schema_version: str
    created_at: datetime


class CandidateExecution(CandidateModel):
    candidate: CandidateRecord
    run: BacktestRunRecord


class CandidateList(CandidateModel):
    items: tuple[CandidateExecution, ...]
