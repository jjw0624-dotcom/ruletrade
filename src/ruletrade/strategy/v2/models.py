"""Canonical v2 authoring models for Profile A.

The v2 envelope deliberately remains distinct from v1.  Values reuse the typed
DailyValueNode algebra verified in Work 2; authoring never invents a parallel
expression language.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal, TypeAlias

from pydantic import Field, model_validator

from ruletrade.strategy.v1.models import (
    AssetSetDefinition,
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


ValueExpressionV2: TypeAlias = (
    DailyValueNode | LiteralValue | CandidateTrailingReturnValue | CandidateCurrentPriceValue
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


ConditionV2: TypeAlias = Annotated[
    ComparisonV2 | BooleanGroupV2 | NotConditionV2,
    Field(discriminator="kind"),
]


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
            elif isinstance(condition, BooleanGroupV2):
                for child in condition.children:
                    visit_condition(child)
            else:
                visit_condition(condition.child)

        visit_value(self.ranking)
        if self.eligibility is not None:
            visit_condition(self.eligibility)
        return self


class StrategyDefinitionsV2(FrozenModel):
    asset_sets: tuple[AssetSetDefinition, ...]
    groups: tuple[GroupDefinition, ...]
    asset_axis: Axis

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


class CanonicalStrategyV2(FrozenModel):
    """A separate persisted semantic envelope; it is never parsed as v1."""

    api_version: Literal["ruletrade.dev/strategy/v2"] = "ruletrade.dev/strategy/v2"
    semantic_profile: Literal["profile-a/daily-compositional-core@1"]
    metadata: StrategyMetadata
    definitions: StrategyDefinitionsV2
    operator_lock: dict[str, str]
    selection: SelectionV2
    predicate: ConditionV2 | None = None

    @model_validator(mode="after")
    def validate_operator_lock(self) -> "CanonicalStrategyV2":
        if "compare" not in self.operator_lock:
            raise ValueError("operator_lock is missing: compare")
        return self


BooleanGroupV2.model_rebuild()
NotConditionV2.model_rebuild()
SelectionV2.model_rebuild()
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
