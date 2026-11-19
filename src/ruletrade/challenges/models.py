from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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
