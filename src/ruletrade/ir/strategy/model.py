from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Literal, TypeAlias


class IRType(StrEnum):
    EVENT = "event"
    ASSET_SET = "asset_set"
    ASSET_SCORES = "asset_scores"
    RANKED_ASSETS = "ranked_assets"
    PORTFOLIO_TARGETS = "portfolio_targets"
    EFFECT = "effect"


@dataclass(frozen=True)
class SourceProvenance:
    """Minimal trace back to the authoritative Strategy Model component."""

    component_id: str


@dataclass(frozen=True)
class PerAssetState:
    """User-visible semantic state introduced by source desugaring."""

    id: str
    value_type: Literal["trading_session_index"]
    initial: None
    provenance: SourceProvenance


@dataclass(frozen=True)
class DailyScheduleOp:
    id: str
    provenance: SourceProvenance
    operation: Literal["schedule.daily"] = "schedule.daily"


@dataclass(frozen=True)
class MonthlyScheduleOp:
    id: str
    day: int
    provenance: SourceProvenance
    operation: Literal["schedule.monthly"] = "schedule.monthly"


@dataclass(frozen=True)
class QuarterlyScheduleOp:
    id: str
    day: int
    provenance: SourceProvenance
    operation: Literal["schedule.quarterly"] = "schedule.quarterly"


@dataclass(frozen=True)
class AssetSetOp:
    id: str
    symbols: tuple[str, ...]
    provenance: SourceProvenance
    operation: Literal["market.asset_set"] = "market.asset_set"


@dataclass(frozen=True)
class UniverseOp:
    """A stable semantic candidate domain resolved at compile time."""

    id: str
    universe_id: str
    source_kind: Literal["asset_set", "group"]
    symbols: tuple[str, ...]
    provenance: SourceProvenance
    operation: Literal["market.universe"] = "market.universe"


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
class TrailingReturnOp:
    id: str
    assets: str
    lookback_bars: int
    provenance: SourceProvenance
    operation: Literal["market.trailing_return"] = "market.trailing_return"


@dataclass(frozen=True)
class ExecutableValue:
    """Small, typed scalar vocabulary supported by every maintained runtime."""

    kind: Literal["literal", "trailing_return", "current_price", "rolling_price", "scale"]
    value_type: Literal["decimal", "percentage", "money_per_share"]
    subject: Literal["asset", "candidate"] | None = None
    asset: str | None = None
    literal: Decimal | None = None
    observations: int | None = None
    aggregate: Literal["mean", "median", "min", "max"] | None = None
    operand: ExecutableValue | None = None
    factor: Decimal | None = None


@dataclass(frozen=True)
class ExecutableComparison:
    operator: Literal["gt", "gte", "lt", "lte"]
    left: ExecutableValue
    right: ExecutableValue


@dataclass(frozen=True)
class FilterClause:
    operator: Literal["gt", "gte", "lt", "lte"]
    threshold: Decimal
    comparison: ExecutableComparison | None = None


@dataclass(frozen=True)
class FilterOp:
    id: str
    scores: str
    operator: Literal["gt", "gte", "lt", "lte"]
    threshold: Decimal
    provenance: SourceProvenance
    clauses: tuple[FilterClause, ...] = ()
    operation: Literal["selection.filter"] = "selection.filter"


@dataclass(frozen=True)
class RankOp:
    id: str
    scores: str
    direction: Literal["descending", "ascending"]
    provenance: SourceProvenance
    value: ExecutableValue | None = None
    operation: Literal["selection.rank"] = "selection.rank"


@dataclass(frozen=True)
class TopNOp:
    id: str
    ranked: str
    count: int
    provenance: SourceProvenance
    shortage_policy: Literal["require_full", "choose_all"] = "require_full"
    operation: Literal["selection.top_n"] = "selection.top_n"


@dataclass(frozen=True)
class ElapsedSessionsGateOp:
    id: str
    candidates: str
    last_exit_state: str
    minimum_completed_sessions: int
    provenance: SourceProvenance
    operation: Literal["selection.elapsed_sessions_gate"] = "selection.elapsed_sessions_gate"


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
class ScaleTargetsOp:
    id: str
    targets: str
    factor: Decimal
    provenance: SourceProvenance
    operation: Literal["portfolio.scale_targets"] = "portfolio.scale_targets"


@dataclass(frozen=True)
class RetainTargetsOp:
    """Latest semantic targets retained between independently scheduled events."""

    id: str
    targets: str
    provenance: SourceProvenance
    operation: Literal["portfolio.retain_targets"] = "portfolio.retain_targets"


@dataclass(frozen=True)
class FirstNonEmptyTargetsOp:
    id: str
    primary: str
    fallback: str
    provenance: SourceProvenance
    operation: Literal["portfolio.first_non_empty_targets"] = "portfolio.first_non_empty_targets"


@dataclass(frozen=True)
class ObserveTargetExitsOp:
    id: str
    targets: str
    last_exit_state: str
    provenance: SourceProvenance
    operation: Literal["state.observe_target_exits"] = "state.observe_target_exits"


@dataclass(frozen=True)
class RebalanceOp:
    id: str
    targets: str
    provenance: SourceProvenance
    operation: Literal["portfolio.rebalance"] = "portfolio.rebalance"


@dataclass(frozen=True)
class PredicateRebalanceOp:
    """Restricted executable IF around a portfolio rebalance."""

    id: str
    asset: str
    lookback_bars: int
    operator: Literal["gt", "gte", "lt", "lte"]
    threshold: Decimal
    targets: str
    provenance: SourceProvenance
    otherwise_targets: str | None = None
    comparisons: tuple[ExecutableComparison, ...] = ()
    operation: Literal["control.predicate_rebalance"] = "control.predicate_rebalance"


StrategyIROperation: TypeAlias = (
    DailyScheduleOp
    | MonthlyScheduleOp
    | QuarterlyScheduleOp
    | AssetSetOp
    | UniverseOp
    | RandomNOp
    | TrailingReturnOp
    | FilterOp
    | RankOp
    | TopNOp
    | ElapsedSessionsGateOp
    | EqualWeightOp
    | ScaleTargetsOp
    | RetainTargetsOp
    | MergeTargetsOp
    | FirstNonEmptyTargetsOp
    | ObserveTargetExitsOp
    | RebalanceOp
    | PredicateRebalanceOp
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
    user_state: tuple[PerAssetState, ...] = ()
