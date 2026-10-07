"""Explicit Canonical v2 envelope for the first Profile A vertical slice."""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, model_validator

from ruletrade.strategy.v1.models import (
    AssetSetDefinition,
    CanonicalStrategyV1,
    GroupDefinition,
    StrategyMetadata,
)
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


ValueExpressionV2 = Annotated[
    LiteralValue | CandidateTrailingReturnValue | CandidateCurrentPriceValue,
    Field(discriminator="kind"),
]


class ComparisonV2(FrozenModel):
    semantic_id: Identifier
    operator: Literal["lt", "lte", "eq", "neq", "gte", "gt"]
    left: ValueExpressionV2
    right: ValueExpressionV2


class SelectionV2(FrozenModel):
    semantic_id: Identifier
    universe_id: Identifier
    binding: CandidateBinding
    eligibility: ComparisonV2 | None = None
    ranking: CandidateTrailingReturnValue | CandidateCurrentPriceValue
    direction: Literal["ascending", "descending"] = "descending"
    count: Annotated[int, Field(ge=1, le=100)]
    shortage_policy: Literal["choose_all", "require_full"] = "choose_all"
    fallback_asset: Symbol | None = None

    @model_validator(mode="after")
    def validate_binding(self) -> "SelectionV2":
        if self.binding.domain_id != self.universe_id:
            raise ValueError("candidate binding must be lexically bound to the Selection universe")
        values = [self.ranking]
        if self.eligibility is not None:
            values += [self.eligibility.left, self.eligibility.right]
        for value in values:
            if hasattr(value, "binding_id") and value.binding_id != self.binding.id:
                raise ValueError("unbound_candidate: Value belongs to a different lexical binder")
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

    @model_validator(mode="after")
    def validate_operator_lock(self) -> "CanonicalStrategyV2":
        required = {"candidate.trailing_return", "compare"}
        missing = required - set(self.operator_lock)
        if missing:
            raise ValueError(f"operator_lock is missing: {', '.join(sorted(missing))}")
        return self


CanonicalStrategyDocument = Annotated[
    CanonicalStrategyV2,
    Field(discriminator="api_version"),
]
