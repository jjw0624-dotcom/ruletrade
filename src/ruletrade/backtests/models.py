from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ruletrade.strategy.v1.models import CanonicalStrategyV1


class BacktestConfig(BaseModel):
    """Run settings; deliberately separate from Canonical strategy semantics."""

    start_date: date = date(2024, 1, 1)
    end_date: date = date(2024, 12, 31)
    initial_cash: Decimal = Field(default=Decimal(100000), gt=0)
    dataset_id: Literal["golden-synthetic"] = "golden-synthetic"

    @model_validator(mode="after")
    def dates_are_ordered(self) -> BacktestConfig:
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class LeanBacktestRequest(BaseModel):
    strategy: CanonicalStrategyV1
    config: BacktestConfig = Field(default_factory=BacktestConfig)


class EquityPoint(BaseModel):
    timestamp: datetime
    value: Decimal


class BacktestResult(BaseModel):
    initial_value: Decimal
    final_value: Decimal
    total_return: Decimal
    total_orders: int = Field(ge=0)
    total_fees: Decimal = Field(ge=0)
    equity_curve: list[EquityPoint]


class LeanBacktestResponse(BaseModel):
    strategy_hash: str
    engine: Literal["lean"] = "lean"
    config: BacktestConfig
    result: BacktestResult
