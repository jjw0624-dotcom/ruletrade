from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.backtest_runs.models import BacktestRunRecord
from ruletrade.backtests.models import BacktestConfig


class ChallengeModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ChallengeKind(str, Enum):
    LEARNING = "learning"
    COMPETITION = "competition"


class ChallengeObjective(ChallengeModel):
    metric: Literal["total_return"] = "total_return"
    direction: Literal["maximize", "minimize"]


class ChallengeConstraints(ChallengeModel):
    allowed_catalog_ids: tuple[str, ...] = Field(min_length=1)
    allowed_assets: tuple[str, ...] = Field(default=())
    required_parameters: dict[str, Any] = Field(default_factory=dict)
    max_total_orders: int | None = Field(default=None, ge=0)


class ChallengeEvaluationPolicy(ChallengeModel):
    version: int = Field(ge=1)
    config: BacktestConfig
    objective: ChallengeObjective
    constraints: ChallengeConstraints


class ChallengeDefinition(ChallengeModel):
    id: str = Field(min_length=1)
    version: int = Field(ge=1)
    kind: ChallengeKind
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    difficulty: Literal["beginner", "intermediate", "advanced"]
    policy: ChallengeEvaluationPolicy


class ChallengeList(ChallengeModel):
    items: tuple[ChallengeDefinition, ...]



class CreateChallengeSubmissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision_id: str = Field(min_length=1)


class ChallengeFeedback(ChallengeModel):
    code: Literal[
        "catalog_family",
        "required_parameter",
        "allowed_assets",
        "max_total_orders",
        "evaluation_failed",
    ]
    target: Literal["catalog", "parameter", "execution", "result"]
    message: str
    parameter: str | None = None
    expected: Any | None = None
    actual: Any | None = None


class ChallengeSubmissionRecord(ChallengeModel):
    id: str
    challenge_id: str
    challenge_version: int = Field(ge=1)
    policy_version: int = Field(ge=1)
    revision_id: str
    strategy_id: str | None = None
    run_id: str
    catalog_id: str | None = None
    catalog_parameters: dict[str, Any] = Field(default_factory=dict)
    eligible: bool
    violations: tuple[str, ...] = ()
    feedback: tuple[ChallengeFeedback, ...] = ()
    score: Decimal | None = None
    objective: ChallengeObjective
    created_at: datetime


class ChallengeSubmissionExecution(ChallengeModel):
    submission: ChallengeSubmissionRecord
    run: BacktestRunRecord


class ChallengeSubmissionList(ChallengeModel):
    items: tuple[ChallengeSubmissionRecord, ...]
