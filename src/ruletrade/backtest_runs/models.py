from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.backtests.models import BacktestConfig, BacktestResult, BacktestTimings


class RunModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BacktestRunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class BacktestRunProvenance(RunModel):
    source_hash: str
    strategy_schema_version: str
    application_version: str
    build_commit: str | None = None
    backend_id: Literal["lean"] = "lean"
    engine_image: str | None = None
    dataset_id: str
    dataset_version: str | None = None


class BacktestRunError(RunModel):
    code: str
    message: str


class BacktestRunRecord(RunModel):
    id: str
    revision_id: str
    status: BacktestRunStatus
    run_config: BacktestConfig
    result: BacktestResult | None = None
    error: BacktestRunError | None = None
    provenance: BacktestRunProvenance
    timings: BacktestTimings
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class CreateBacktestRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: dict[str, Any] = Field(default_factory=dict)


class BacktestRunList(RunModel):
    items: list[BacktestRunRecord]
