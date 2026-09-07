from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict


class ConditionStatus(StrEnum):
    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


class ConditionEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: ConditionStatus
    condition_type: str
    observed_value: float | None = None
    threshold: float | None = None
    details: dict[str, Any] = {}
    reason: str | None = None
