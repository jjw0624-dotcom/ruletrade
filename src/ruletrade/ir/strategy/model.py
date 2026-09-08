from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Literal, TypeAlias


class IRType(StrEnum):
    EVENT = "event"
    ASSET_SET = "asset_set"
    PORTFOLIO_TARGETS = "portfolio_targets"
    EFFECT = "effect"


@dataclass(frozen=True)
class SourceProvenance:
    """Minimal trace back to the authoritative Strategy Model component."""

    component_id: str


@dataclass(frozen=True)
class MonthlyScheduleOp:
    id: str
    day: int
    provenance: SourceProvenance
    operation: Literal["schedule.monthly"] = "schedule.monthly"


@dataclass(frozen=True)
class AssetSetOp:
    id: str
    symbols: tuple[str, ...]
    provenance: SourceProvenance
    operation: Literal["market.asset_set"] = "market.asset_set"


@dataclass(frozen=True)
class RandomNOp:
    id: str
    assets: str
    count: int
    resample: Literal["once", "per_event"]
    parameter_bindings_json: str
    provenance: SourceProvenance
    operation: Literal["selection.random_n"] = "selection.random_n"


@dataclass(frozen=True)
class EqualWeightOp:
    id: str
    assets: str
    total_weight: Decimal
    provenance: SourceProvenance
    operation: Literal["portfolio.equal_weight"] = "portfolio.equal_weight"


@dataclass(frozen=True)
class MergeTargetsOp:
    id: str
    left: str
    right: str
    provenance: SourceProvenance
    operation: Literal["portfolio.merge_targets"] = "portfolio.merge_targets"


@dataclass(frozen=True)
class RebalanceOp:
    id: str
    targets: str
    provenance: SourceProvenance
    operation: Literal["portfolio.rebalance"] = "portfolio.rebalance"


StrategyIROperation: TypeAlias = (
    MonthlyScheduleOp
    | AssetSetOp
    | RandomNOp
    | EqualWeightOp
    | MergeTargetsOp
    | RebalanceOp
)


@dataclass(frozen=True)
class IREntrypoint:
    event: str
    target: str


@dataclass(frozen=True)
class StrategyIR:
    """Typed, backend-independent HIR derived from the Strategy Model."""

    strategy_identity: str
    operations: tuple[StrategyIROperation, ...]
    entrypoints: tuple[IREntrypoint, ...]
