from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Weight = Annotated[
    Decimal,
    Field(ge=Decimal("0"), le=Decimal("1")),
]


class AllSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["all"] = "all"


class RandomNSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["random_n"] = "random_n"
    count: Annotated[int, Field(gt=0)]


SelectionSpec = AllSelection | RandomNSelection


class EqualWeightAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["equal_weight"] = "equal_weight"


class FixedWeightItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    symbol: Annotated[
        str,
        Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:-]+$"),
    ]
    weight: Weight

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()


class FixedWeightAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["fixed_weight"] = "fixed_weight"
    weights: Annotated[list[FixedWeightItem], Field(min_length=1)]

    @model_validator(mode="after")
    def validate_weights(self) -> "FixedWeightAllocation":
        symbols = [item.symbol for item in self.weights]

        if len(symbols) != len(set(symbols)):
            raise ValueError("fixed allocation symbols must be unique")

        total = sum((item.weight for item in self.weights), Decimal("0"))

        if abs(total - Decimal("1")) > Decimal("0.00000001"):
            raise ValueError(f"fixed allocation weights must sum to 1; got {total}")

        return self


AllocationSpec = EqualWeightAllocation | FixedWeightAllocation


class StrategyGroup(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Annotated[
        str,
        Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
    ]
    weight: Weight
    universe: Annotated[list[str], Field(min_length=1)]
    selection: SelectionSpec
    allocation: AllocationSpec

    @field_validator("universe")
    @classmethod
    def normalize_universe(cls, value: list[str]) -> list[str]:
        normalized = [symbol.strip().upper() for symbol in value]

        if any(not symbol for symbol in normalized):
            raise ValueError("group universe symbols must not be empty")

        if len(normalized) != len(set(normalized)):
            raise ValueError("group universe symbols must be unique")

        return normalized

    @model_validator(mode="after")
    def validate_group(self) -> "StrategyGroup":
        if isinstance(self.selection, RandomNSelection):
            if self.selection.count > len(self.universe):
                raise ValueError(
                    "random_n count cannot exceed group universe size"
                )

        if isinstance(self.allocation, FixedWeightAllocation):
            universe = set(self.universe)
            allocation_symbols = {
                item.symbol for item in self.allocation.weights
            }

            if allocation_symbols != universe:
                raise ValueError(
                    "fixed allocation symbols must exactly match group universe"
                )

        return self


class RebalanceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["on_start", "monthly"]


class StrategyDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    api_version: Literal["ruletrade.dev/strategy/v0"] = (
        "ruletrade.dev/strategy/v0"
    )

    name: Annotated[str, Field(min_length=1, max_length=100)]

    random_seed: int = 0

    groups: Annotated[
        list[StrategyGroup],
        Field(min_length=1),
    ]

    rebalance: RebalanceSpec

    @model_validator(mode="after")
    def validate_strategy(self) -> "StrategyDocument":
        group_ids = [group.id for group in self.groups]

        if len(group_ids) != len(set(group_ids)):
            raise ValueError("group ids must be unique")

        total = sum(
            (group.weight for group in self.groups),
            Decimal("0"),
        )

        if abs(total - Decimal("1")) > Decimal("0.00000001"):
            raise ValueError(
                f"group weights must sum to 1; got {total}"
            )

        return self
