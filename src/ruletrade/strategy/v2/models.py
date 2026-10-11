"""Canonical v2 authoring models for Profile A.

The v2 envelope deliberately remains distinct from v1.  Values reuse the typed
DailyValueNode algebra verified in Work 2; authoring never invents a parallel
expression language.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal, TypeAlias

from pydantic import Field, field_validator, model_validator

from ruletrade.strategy.v1.models import (
    CanonicalStrategyV1,
    GroupDefinition,
    StrategyMetadata,
)
from ruletrade.strategy.v2.daily_values import DailyValueNode, SubjectKind, infer_daily_type
from ruletrade.strategy.v2.semantic_types import (
    Axis,
    Clock,
    FrozenModel,
    Quantity,
    SemanticDType,
    SemanticType,
    Unit,
)


Identifier = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z][A-Za-z0-9_-]*$")]
Symbol = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:-]+$")]


class AssetSetDefinitionV2(FrozenModel):
    """An authoring AssetSet may be empty until the user chooses symbols."""

    id: Identifier
    assets: list[Symbol] = Field(default_factory=list, max_length=500)

    @field_validator("assets", mode="before")
    @classmethod
    def normalize_assets(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)) or not all(isinstance(item, str) for item in value):
            return value
        normalized = [item.strip().upper() for item in value]
        if len(normalized) != len(set(normalized)):
            raise ValueError("asset set symbols must be unique")
        return normalized


class CandidateBinding(FrozenModel):
    id: Identifier
    domain_id: Identifier


# Legacy bridge nodes stay readable so Work 2/v1 lowering remains stable. New
# authoring emits DailyValueNode.
class LiteralValue(FrozenModel):
    kind: Literal["literal"] = "literal"
    semantic_id: Identifier
    value: Decimal
    quantity: Quantity
    unit: Unit
    refinement: str | None = None

    @property
    def semantic_type(self) -> SemanticType:
        return SemanticType(
            dtype=SemanticDType.DECIMAL,
            quantity=self.quantity,
            unit=self.unit,
            refinement=self.refinement,
        )


class CandidateTrailingReturnValue(FrozenModel):
    kind: Literal["candidate_trailing_return"] = "candidate_trailing_return"
    semantic_id: Identifier
    binding_id: Identifier
    lookback_observations: Annotated[int, Field(ge=1, le=1000)]
    clock: Clock = Field(default_factory=lambda: Clock(id="daily-close"))

    @property
    def semantic_type(self) -> SemanticType:
        return SemanticType(
            dtype=SemanticDType.DECIMAL,
            quantity=Quantity.RETURN,
            unit=Unit.RATIO,
            refinement="trailing_return:adjusted_close",
            clock=self.clock,
        )


class CandidateCurrentPriceValue(FrozenModel):
    kind: Literal["candidate_current_price"] = "candidate_current_price"
    semantic_id: Identifier
    binding_id: Identifier
    clock: Clock = Field(default_factory=lambda: Clock(id="daily-close"))

    @property
    def semantic_type(self) -> SemanticType:
        return SemanticType(
            dtype=SemanticDType.DECIMAL,
            quantity=Quantity.PRICE,
            unit=Unit.USD_PER_SHARE,
            refinement="adjusted_close",
            clock=self.clock,
        )


class CrossSectionalValueV2(FrozenModel):
    """A domain-relative transform. The source is evaluated once per member."""

    kind: Literal["cross_sectional"] = "cross_sectional"
    semantic_id: Identifier
    source: "DailyValueNode | ScoreValueV2"
    domain_id: Identifier
    transform: Literal["rank", "percentile", "quantile", "bucket", "min_max", "zscore"]
    direction: Literal["ascending", "descending"] = "descending"
    bins: Annotated[int, Field(ge=2, le=100)] | None = None

    @model_validator(mode="after")
    def validate_bins(self) -> "CrossSectionalValueV2":
        if self.transform in {"quantile", "bucket"} and self.bins is None:
            raise ValueError("quantile/bucket requires bins")
        if self.transform in {"rank", "percentile", "min_max", "zscore"} and self.bins is not None:
            raise ValueError("rank/percentile/normalization does not accept bins")
        return self


class ScoreTermV2(FrozenModel):
    semantic_id: Identifier
    value: DailyValueNode | CrossSectionalValueV2
    weight: Decimal


class ScoreValueV2(FrozenModel):
    kind: Literal["score"] = "score"
    semantic_id: Identifier
    terms: tuple[ScoreTermV2, ...] = Field(default=(), max_length=20)
    condition_terms: tuple["ConditionPointTermV2", ...] = Field(default=(), max_length=20)
    missing_policy: Literal["require_all", "renormalize_available"] = "require_all"
    normalization: Literal["none", "sum_abs"] = "none"
    clamp_min: Decimal | None = None
    clamp_max: Decimal | None = None

    @model_validator(mode="after")
    def validate_terms(self) -> "ScoreValueV2":
        term_ids = [term.semantic_id for term in self.terms] + [term.semantic_id for term in self.condition_terms]
        if len(term_ids) != len(set(term_ids)):
            raise ValueError("Score term semantic ids must be unique")
        if not self.terms and not self.condition_terms:
            raise ValueError("Score requires at least one Value or Condition term")
        if self.terms and not self.condition_terms and not any(term.weight != 0 for term in self.terms):
            raise ValueError("Score requires at least one non-zero weight")
        if self.clamp_min is not None and self.clamp_max is not None and self.clamp_min > self.clamp_max:
            raise ValueError("Score clamp_min cannot exceed clamp_max")
        return self


class CrossSectionalAggregateValueV2(FrozenModel):
    """One scalar reduced across the explicitly named Candidate domain."""

    kind: Literal["cross_sectional_aggregate"] = "cross_sectional_aggregate"
    semantic_id: Identifier
    source: DailyValueNode | ScoreValueV2
    domain_id: Identifier
    reduction: Literal["mean", "median", "min", "max"]
    coverage: Literal["require_all", "available_only"] = "require_all"


class EventRelativeValueV2(FrozenModel):
    kind: Literal["event_relative"] = "event_relative"
    semantic_id: Identifier
    event_id: Identifier
    source: DailyValueNode
    offset_observations: Annotated[int, Field(ge=-2000, le=2000)] = 0


class ClockedValueV2(FrozenModel):
    """Evaluate a daily Value at the last completed boundary of an explicit clock."""

    kind: Literal["clocked_value"] = "clocked_value"
    semantic_id: Identifier
    source: DailyValueNode
    clock_id: Identifier


class RememberedValueV2(FrozenModel):
    kind: Literal["remembered_value"] = "remembered_value"
    semantic_id: Identifier
    memory_id: Identifier
    quantity: Quantity
    unit: Unit
    refinement: str | None = None


class BarsSinceEventValueV2(FrozenModel):
    kind: Literal["bars_since_event"] = "bars_since_event"
    semantic_id: Identifier
    event_id: Identifier


class BarsSinceStateValueV2(FrozenModel):
    kind: Literal["bars_since_state"] = "bars_since_state"
    semantic_id: Identifier
    state_key: Identifier


class TimeSinceEventValueV2(FrozenModel):
    kind: Literal["time_since_event"] = "time_since_event"
    semantic_id: Identifier
    event_id: Identifier


class TimeSinceStateValueV2(FrozenModel):
    kind: Literal["time_since_state"] = "time_since_state"
    semantic_id: Identifier
    state_key: Identifier


ValueExpressionV2: TypeAlias = (
    DailyValueNode
    | LiteralValue
    | CandidateTrailingReturnValue
    | CandidateCurrentPriceValue
    | CrossSectionalValueV2
    | CrossSectionalAggregateValueV2
    | ScoreValueV2
    | EventRelativeValueV2
    | ClockedValueV2
    | RememberedValueV2
    | BarsSinceEventValueV2
    | BarsSinceStateValueV2
    | TimeSinceEventValueV2
    | TimeSinceStateValueV2
)


class ComparisonV2(FrozenModel):
    kind: Literal["comparison"] = "comparison"
    semantic_id: Identifier
    operator: Literal["lt", "lte", "eq", "neq", "gte", "gt"]
    left: ValueExpressionV2
    right: ValueExpressionV2


class BooleanGroupV2(FrozenModel):
    kind: Literal["all", "any"]
    semantic_id: Identifier
    children: tuple["ConditionV2", ...] = Field(min_length=1, max_length=12)


class NotConditionV2(FrozenModel):
    kind: Literal["not"] = "not"
    semantic_id: Identifier
    child: "ConditionV2"


class StateConditionV2(FrozenModel):
    """An explicit Program-state predicate; never valid as Selection Eligibility."""

    kind: Literal["state_equals"] = "state_equals"
    semantic_id: Identifier
    state_key: Identifier
    expected: str


class NOfMConditionV2(FrozenModel):
    kind: Literal["n_of_m"] = "n_of_m"
    semantic_id: Identifier
    minimum_true: Annotated[int, Field(ge=1, le=12)]
    children: tuple["ConditionV2", ...] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_threshold(self) -> "NOfMConditionV2":
        if self.minimum_true > len(self.children):
            raise ValueError("minimum_true cannot exceed child count")
        return self


class EventWindowConditionV2(FrozenModel):
    kind: Literal["event_window"] = "event_window"
    semantic_id: Identifier
    event_id: Identifier
    relation: Literal["before", "after", "within"]
    observations: Annotated[int, Field(ge=0, le=2000)] | None = None

    @model_validator(mode="after")
    def validate_window(self) -> "EventWindowConditionV2":
        if self.relation == "within" and self.observations is None:
            raise ValueError("within requires an observation window")
        if self.relation in {"before", "after"} and self.observations is not None:
            raise ValueError("before/after does not accept an observation window")
        return self


ConditionV2: TypeAlias = Annotated[
    ComparisonV2 | BooleanGroupV2 | NotConditionV2 | StateConditionV2
    | NOfMConditionV2 | EventWindowConditionV2,
    Field(discriminator="kind"),
]


class ConditionPointTermV2(FrozenModel):
    semantic_id: Identifier
    condition: ConditionV2
    true_points: Decimal
    false_points: Decimal = Decimal(0)
    unknown_points: Decimal | None = None


class SelectionV2(FrozenModel):
    semantic_id: Identifier
    universe_id: Identifier
    binding: CandidateBinding
    eligibility: ConditionV2 | None = None
    ranking: ValueExpressionV2
    direction: Literal["ascending", "descending"] = "descending"
    count: Annotated[int, Field(ge=1, le=100)]
    shortage_policy: Literal["choose_all", "require_full"] = "choose_all"
    fallback_asset: Symbol | None = None

    @model_validator(mode="after")
    def validate_binding(self) -> "SelectionV2":
        if self.binding.domain_id != self.universe_id:
            raise ValueError("candidate binding must be lexically bound to the Selection universe")

        def visit_value(value: ValueExpressionV2) -> None:
            if isinstance(value, DailyValueNode):
                stack = [value]
                while stack:
                    node = stack.pop()
                    if node.subject_kind == SubjectKind.CANDIDATE and node.binding_id != self.binding.id:
                        raise ValueError("unbound_candidate: Value belongs to a different lexical binder")
                    stack.extend(node.operands)
            elif hasattr(value, "binding_id") and value.binding_id != self.binding.id:
                raise ValueError("unbound_candidate: Value belongs to a different lexical binder")

        def visit_condition(condition: ConditionV2) -> None:
            if isinstance(condition, ComparisonV2):
                visit_value(condition.left)
                visit_value(condition.right)
            elif isinstance(condition, (BooleanGroupV2, NOfMConditionV2)):
                for child in condition.children:
                    visit_condition(child)
            elif isinstance(condition, NotConditionV2):
                visit_condition(condition.child)

        visit_value(self.ranking)
        if self.eligibility is not None:
            visit_condition(self.eligibility)
        return self


class StrategyDefinitionsV2(FrozenModel):
    asset_sets: tuple[AssetSetDefinitionV2, ...]
    groups: tuple[GroupDefinition, ...]
    asset_axis: Axis

    @field_validator("asset_sets", mode="before")
    @classmethod
    def accept_existing_asset_sets(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            return value
        return tuple(
            item.model_dump(mode="python") if hasattr(item, "model_dump") else item
            for item in value
        )

    @model_validator(mode="after")
    def validate_definitions(self) -> "StrategyDefinitionsV2":
        asset_sets = {item.id for item in self.asset_sets}
        if not asset_sets:
            raise ValueError("v2 requires at least one explicit/static AssetSet")
        for group in self.groups:
            if group.asset_set_ref not in asset_sets:
                raise ValueError(f"unknown asset set: {group.asset_set_ref}")
        if self.asset_axis.name != "asset":
            raise ValueError("Profile A v2 uses an Asset axis for Selection domains")
        return self


class ProgramClockV2(FrozenModel):
    id: Identifier
    timeframe: Literal["session", "daily", "weekly", "monthly"]
    boundary: Literal["close"] = "close"
    timezone: str = "UTC"
    completed_only: Literal[True] = True
    terminal_boundary_policy: Literal["not_due", "fixture_end_is_boundary"] = "not_due"


class EventDefinitionV2(FrozenModel):
    semantic_id: Identifier
    clock_id: Identifier
    condition: ConditionV2 | None = None
    trigger: Literal[
        "rising_edge", "falling_edge", "while_true", "became_true", "became_false",
        "crosses_above", "crosses_below", "scheduled",
    ] = "rising_edge"
    occurrence: Literal["every", "first", "ordinal"] = "every"
    ordinal: Annotated[int, Field(ge=1, le=10000)] | None = None

    @model_validator(mode="after")
    def validate_event_shape(self) -> "EventDefinitionV2":
        if self.trigger == "scheduled" and self.condition is not None:
            raise ValueError("scheduled Event cannot carry a Condition")
        if self.trigger != "scheduled" and self.condition is None:
            raise ValueError("non-scheduled Event requires a Condition")
        if self.occurrence == "ordinal" and self.ordinal is None:
            raise ValueError("ordinal Event requires ordinal")
        if self.occurrence != "ordinal" and self.ordinal is not None:
            raise ValueError("ordinal is only valid for ordinal Events")
        return self


class AllocationTargetV2(FrozenModel):
    semantic_id: Identifier
    kind: Literal["asset", "selection", "group", "cash", "retain"]
    ref: str | None = None

    @model_validator(mode="after")
    def validate_ref(self) -> "AllocationTargetV2":
        if self.kind in {"asset", "selection", "group"} and not self.ref:
            raise ValueError(f"{self.kind} allocation target requires ref")
        if self.kind in {"cash", "retain"} and self.ref is not None:
            raise ValueError(f"{self.kind} allocation target cannot have ref")
        return self


class AllocationLegV2(FrozenModel):
    semantic_id: Identifier
    target: AllocationTargetV2
    weight: Decimal | None = Field(default=None, ge=0, le=1)


class AllocationStatementV2(FrozenModel):
    kind: Literal["allocate"] = "allocate"
    semantic_id: Identifier
    method: Literal["equal", "fixed", "proportional_score", "inverse_volatility"]
    legs: tuple[AllocationLegV2, ...] = Field(min_length=1, max_length=100)
    clock_id: Identifier | None = None
    minimum_weight: Decimal | None = Field(default=None, ge=0, le=1)
    maximum_weight: Decimal | None = Field(default=None, ge=0, le=1)
    cash_remainder_asset: Symbol | None = None

    @model_validator(mode="after")
    def validate_weights(self) -> "AllocationStatementV2":
        retain_legs = [leg for leg in self.legs if leg.target.kind == "retain"]
        if retain_legs and (len(self.legs) != 1 or self.method != "equal"):
            raise ValueError("retain must be the sole target of an equal allocation")
        if self.method == "fixed":
            if any(leg.weight is None for leg in self.legs):
                raise ValueError("fixed allocation requires every weight")
            if sum((leg.weight or Decimal(0) for leg in self.legs), Decimal(0)) != Decimal(1):
                raise ValueError("fixed allocation weights must sum exactly to 1")
        elif any(leg.weight is not None for leg in self.legs):
            raise ValueError("derived allocation methods cannot persist explicit weights")
        if self.minimum_weight is not None and self.maximum_weight is not None and self.minimum_weight > self.maximum_weight:
            raise ValueError("minimum_weight cannot exceed maximum_weight")
        if self.method in {"proportional_score", "inverse_volatility"}:
            if len(self.legs) != 1 or self.legs[0].target.kind != "selection":
                raise ValueError("score-derived allocation requires exactly one Selection target")
        if self.method in {"equal", "fixed"} and (
            self.minimum_weight is not None or self.maximum_weight is not None or self.cash_remainder_asset is not None
        ):
            raise ValueError("cap/floor/cash remainder belong to score-derived allocation")
        return self


class SelectionStatementV2(FrozenModel):
    kind: Literal["select"] = "select"
    semantic_id: Identifier
    selection: SelectionV2
    output_id: Identifier
    clock_id: Identifier | None = None


class StateTransitionV2(FrozenModel):
    semantic_id: Identifier
    state_key: Identifier
    from_value: str | None = None
    to_value: str
    when: ConditionV2
    clock_id: Identifier | None = None


class StateTransitionStatementV2(FrozenModel):
    kind: Literal["transition"] = "transition"
    semantic_id: Identifier
    transition: StateTransitionV2


class RememberValueStatementV2(FrozenModel):
    kind: Literal["remember_value"] = "remember_value"
    semantic_id: Identifier
    memory_id: Identifier
    value: ValueExpressionV2
    clock_id: Identifier | None = None


class EventStatementV2(FrozenModel):
    kind: Literal["on_event"] = "on_event"
    semantic_id: Identifier
    event: EventDefinitionV2
    statements: tuple["ProgramStatementV2", ...] = Field(min_length=1, max_length=100)


class ConditionalStatementV2(FrozenModel):
    kind: Literal["control"] = "control"
    semantic_id: Identifier
    condition: ConditionV2
    then_statements: tuple["ProgramStatementV2", ...] = Field(min_length=1, max_length=100)
    otherwise_statements: tuple["ProgramStatementV2", ...] = Field(default=(), max_length=100)
    unknown_policy: Literal["retain", "otherwise"] = "retain"
    clock_id: Identifier | None = None


class OverrideRuleV2(FrozenModel):
    semantic_id: Identifier
    priority: int
    when: ConditionV2
    action: AllocationStatementV2


class GuardedAllocationStatementV2(FrozenModel):
    kind: Literal["guarded_allocation"] = "guarded_allocation"
    semantic_id: Identifier
    guard: ConditionV2 | None = None
    primary: AllocationStatementV2
    overrides: tuple[OverrideRuleV2, ...] = Field(default=(), max_length=20)
    fallback: AllocationStatementV2 | None = None
    unknown_guard_policy: Literal["block", "allow"] = "block"


class UnresolvedStatementV2(FrozenModel):
    kind: Literal["unresolved"] = "unresolved"
    semantic_id: Identifier
    source_text: str = Field(min_length=1, max_length=2000)
    category: Literal["fuzzy_term", "missing_reference", "unsupported_semantics"]
    reason: str = Field(min_length=1, max_length=500)


ProgramStatementV2: TypeAlias = Annotated[
    SelectionStatementV2
    | AllocationStatementV2
    | ConditionalStatementV2
    | EventStatementV2
    | StateTransitionStatementV2
    | RememberValueStatementV2
    | GuardedAllocationStatementV2
    | UnresolvedStatementV2,
    Field(discriminator="kind"),
]


class FormalizationProvenanceV2(FrozenModel):
    source_phrase: str = Field(min_length=1, max_length=500)
    status: Literal["formalized", "unresolved"]
    semantic_ids: tuple[Identifier, ...] = Field(default=(), max_length=100)
    interpretation: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_formalization(self) -> "FormalizationProvenanceV2":
        if self.status == "unresolved" and self.semantic_ids:
            raise ValueError("unresolved phrase cannot claim executable semantic ids")
        if self.status == "formalized" and (not self.semantic_ids or not self.interpretation):
            raise ValueError("formalized phrase requires semantic ids and interpretation")
        return self


class SemanticProgramV2(FrozenModel):
    semantic_id: Identifier
    clocks: tuple[ProgramClockV2, ...] = Field(min_length=1, max_length=20)
    initial_state: dict[Identifier, str] = Field(default_factory=dict)
    formalizations: tuple[FormalizationProvenanceV2, ...] = Field(default=(), max_length=100)
    statements: tuple[ProgramStatementV2, ...] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_identity(self) -> "SemanticProgramV2":
        clock_ids = [clock.id for clock in self.clocks]
        if len(clock_ids) != len(set(clock_ids)):
            raise ValueError("Program clock ids must be unique")
        return self


class CanonicalStrategyV2(FrozenModel):
    """A separate persisted semantic envelope; it is never parsed as v1."""

    api_version: Literal["ruletrade.dev/strategy/v2"] = "ruletrade.dev/strategy/v2"
    semantic_profile: Literal["profile-a/daily-compositional-core@1"]
    metadata: StrategyMetadata
    definitions: StrategyDefinitionsV2
    operator_lock: dict[str, str]
    selection: SelectionV2 | None = None
    predicate: ConditionV2 | None = None
    program: SemanticProgramV2 | None = None

    @model_validator(mode="after")
    def validate_operator_lock(self) -> "CanonicalStrategyV2":
        if "compare" not in self.operator_lock:
            raise ValueError("operator_lock is missing: compare")
        if self.selection is None and self.program is None:
            raise ValueError("v2 requires a compatibility Selection or a Semantic Program")
        return self


BooleanGroupV2.model_rebuild()
NotConditionV2.model_rebuild()
StateConditionV2.model_rebuild()
NOfMConditionV2.model_rebuild()
EventWindowConditionV2.model_rebuild()
ConditionPointTermV2.model_rebuild()
ScoreValueV2.model_rebuild()
CrossSectionalValueV2.model_rebuild()
CrossSectionalAggregateValueV2.model_rebuild()
SelectionV2.model_rebuild()
EventStatementV2.model_rebuild()
ConditionalStatementV2.model_rebuild()
SemanticProgramV2.model_rebuild()
CanonicalStrategyV2.model_rebuild()

CanonicalStrategy = CanonicalStrategyV1 | CanonicalStrategyV2


def parse_canonical_strategy(value: object) -> CanonicalStrategy:
    """Parse only by explicit api_version; never reinterpret v1 as v2."""

    if isinstance(value, (CanonicalStrategyV1, CanonicalStrategyV2)):
        return value
    if not isinstance(value, dict):
        raise ValueError("canonical Strategy must be an object")
    version = value.get("api_version")
    # Pre-version-field v1 fixtures remain accepted as legacy v1; persisted
    # snapshots are normalized with CanonicalStrategyV1's explicit default.
    if version in {None, "ruletrade.dev/strategy/v1"}:
        return CanonicalStrategyV1.model_validate(value)
    if version == "ruletrade.dev/strategy/v2":
        return CanonicalStrategyV2.model_validate(value)
    raise ValueError(f"unsupported canonical api_version: {version!r}")
