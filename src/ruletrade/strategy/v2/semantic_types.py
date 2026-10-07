"""Profile A semantic primitives.

These types are intentionally independent from v1 Canonical serialization.  They
describe what a value means; v1 adapters decide whether a restricted subset can
be lowered to the maintained compiler.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SemanticDType(StrEnum):
    DECIMAL = "decimal"
    INTEGER = "integer"
    TRUTH = "truth"


class Quantity(StrEnum):
    PRICE = "price"
    RETURN = "return"
    VOLUME = "volume"
    OSCILLATOR = "oscillator"
    SCORE = "score"
    MONEY = "money"
    WEIGHT = "weight"
    COUNT = "count"
    TRUTH = "truth"


class Unit(StrEnum):
    USD_PER_SHARE = "USD/share"
    USD = "USD"
    RATIO = "ratio"
    POINTS = "points"
    SHARES = "shares"
    COUNT = "count"
    TRUTH = "truth"


class Axis(FrozenModel):
    """A named coordinate axis.  Domain identity is part of compatibility."""

    name: Literal["asset", "time"]
    domain_id: str = Field(min_length=1)
    coordinate_policy: str = Field(default="stable_identity", min_length=1)


class Clock(FrozenModel):
    id: str = Field(min_length=1)
    completed_observations_only: bool = True
    sampling: str = Field(default="daily", min_length=1)


class SemanticType(FrozenModel):
    dtype: SemanticDType
    quantity: Quantity
    unit: Unit
    refinement: str | None = None
    axes: tuple[Axis, ...] = ()
    clock: Clock | None = None


class SemanticTypeError(ValueError):
    pass


class TruthValue(StrEnum):
    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


def truth_and(left: TruthValue, right: TruthValue) -> TruthValue:
    if TruthValue.FALSE in {left, right}:
        return TruthValue.FALSE
    if TruthValue.UNKNOWN in {left, right}:
        return TruthValue.UNKNOWN
    return TruthValue.TRUE


def truth_or(left: TruthValue, right: TruthValue) -> TruthValue:
    if TruthValue.TRUE in {left, right}:
        return TruthValue.TRUE
    if TruthValue.UNKNOWN in {left, right}:
        return TruthValue.UNKNOWN
    return TruthValue.FALSE


def truth_not(value: TruthValue) -> TruthValue:
    return {
        TruthValue.TRUE: TruthValue.FALSE,
        TruthValue.FALSE: TruthValue.TRUE,
        TruthValue.UNKNOWN: TruthValue.UNKNOWN,
    }[value]


def aligned_axes(left: SemanticType, right: SemanticType) -> tuple[Axis, ...]:
    """Return the safe broadcast result axes or reject implicit Cartesian joins."""

    left_axes = {(axis.name, axis.domain_id): axis for axis in left.axes}
    right_axes = {(axis.name, axis.domain_id): axis for axis in right.axes}
    left_names = {axis.name for axis in left.axes}
    right_names = {axis.name for axis in right.axes}

    for name in left_names & right_names:
        left_domain = next(axis.domain_id for axis in left.axes if axis.name == name)
        right_domain = next(axis.domain_id for axis in right.axes if axis.name == name)
        if left_domain != right_domain:
            raise SemanticTypeError(
                f"axis_domain_mismatch: {name}@{left_domain} is not {name}@{right_domain}"
            )

    if not left_axes:
        return right.axes
    if not right_axes:
        return left.axes
    if set(left_axes).issubset(right_axes):
        return right.axes
    if set(right_axes).issubset(left_axes):
        return left.axes
    raise SemanticTypeError(
        "implicit_cartesian_broadcast_forbidden: axes must be scalar or an existing compatible subset"
    )


def require_compatible_values(left: SemanticType, right: SemanticType) -> tuple[Axis, ...]:
    if left.quantity != right.quantity or left.unit != right.unit or left.refinement != right.refinement:
        raise SemanticTypeError(
            "unit_mismatch: comparison requires equal quantity, unit, and refinement"
        )
    if left.clock is not None and right.clock is not None and left.clock != right.clock:
        raise SemanticTypeError("clock_alignment_required")
    return aligned_axes(left, right)


def semantic_content_hash(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class HistoryRequirement:
    minimum_history_lower_bound: int
    seed_anchor_required: bool = False
    checkpoint_identity_required: bool = False

    def compose_history(self, count: int, *, skip: int = 0) -> "HistoryRequirement":
        return HistoryRequirement(
            minimum_history_lower_bound=self.minimum_history_lower_bound + count + skip,
            seed_anchor_required=self.seed_anchor_required,
            checkpoint_identity_required=self.checkpoint_identity_required,
        )


@dataclass(frozen=True)
class EvaluationContext:
    decision_at: str
    data_cutoff: str
    dataset_snapshot_id: str
    domain_snapshot_ids: tuple[str, ...]
    scope_id: str | None
    candidate_binding_id: str | None
    operator_lock: tuple[tuple[str, str], ...]
    run_id: str | None = None

    def cache_key(self, expression_content_hash: str) -> str:
        return semantic_content_hash({
            "expression": expression_content_hash,
            "decision_at": self.decision_at,
            "data_cutoff": self.data_cutoff,
            "dataset_snapshot_id": self.dataset_snapshot_id,
            "domain_snapshot_ids": self.domain_snapshot_ids,
            "scope_id": self.scope_id,
            "candidate_binding_id": self.candidate_binding_id,
            "operator_lock": self.operator_lock,
            "run_id": self.run_id,
        })


def asset_axis(domain_id: str) -> Axis:
    return Axis(name="asset", domain_id=domain_id)


def time_axis(clock: Clock) -> Axis:
    return Axis(name="time", domain_id=f"{clock.id}:completed", coordinate_policy="timestamp")
