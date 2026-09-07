from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class RebalanceFrequency(StrEnum):
    ONCE = "once"
    MONTHLY = "monthly"


class AssetAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    symbol: Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:-]+$")]
    weight: Annotated[Decimal, Field(gt=Decimal("0"), le=Decimal("1"))]

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return value.strip().upper()


class RecurringContribution(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    amount: Annotated[Decimal, Field(gt=Decimal("0"))]
    frequency: Literal["monthly"] = "monthly"


class SimpleStrategySpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    api_version: Literal["ruletrade.dev/simple/v0"] = "ruletrade.dev/simple/v0"
    name: Annotated[str, Field(min_length=1, max_length=100)]
    currency: Annotated[str, Field(min_length=3, max_length=3)] = "USD"
    initial_capital: Annotated[Decimal, Field(gt=Decimal("0"))]
    recurring_contribution: RecurringContribution | None = None
    rebalance: RebalanceFrequency = RebalanceFrequency.MONTHLY
    assets: Annotated[list[AssetAllocation], Field(min_length=1, max_length=20)]

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def validate_portfolio(self) -> "SimpleStrategySpec":
        symbols = [asset.symbol for asset in self.assets]
        if len(symbols) != len(set(symbols)):
            raise ValueError("asset symbols must be unique")

        total = sum((asset.weight for asset in self.assets), Decimal("0"))
        if abs(total - Decimal("1")) > Decimal("0.00000001"):
            raise ValueError(f"asset weights must sum to 1; got {total}")

        if self.recurring_contribution is not None and self.rebalance != RebalanceFrequency.MONTHLY:
            raise ValueError("recurring contributions require monthly rebalance in simple/v0")

        return self


class BacktestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    commission_bps: Annotated[Decimal, Field(ge=Decimal("0"), le=Decimal("100"))] = Decimal("0")
    allow_fractional_shares: bool = True


class BacktestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy: SimpleStrategySpec
    dataset_id: Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")]
    config: BacktestConfig = Field(default_factory=BacktestConfig)
