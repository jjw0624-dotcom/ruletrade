from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ruletrade.strategy.v1.models import CanonicalStrategyV1


class BacktestConfig(BaseModel):
    """Run settings; deliberately separate from Canonical strategy semantics."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    start_date: date = date(2024, 1, 1)
    end_date: date = date(2024, 12, 31)
    initial_cash: Decimal = Field(default=Decimal(100000), gt=0)
    dataset_id: Literal[
        "golden-synthetic",
        "filter-synthetic",
        "cooldown-synthetic",
        "us-equity-daily-local",
    ] = "golden-synthetic"

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


class BacktestTimings(BaseModel):
    """Measured wall-clock stage durations; diagnostic, never strategy semantics."""

    source_load_ms: int = Field(default=0, ge=0)
    validation_ms: int = Field(default=0, ge=0)
    data_preflight_ms: int = Field(default=0, ge=0)
    data_acquisition_ms: int = Field(default=0, ge=0)
    compiler_ms: int = Field(default=0, ge=0)
    codegen_ms: int = Field(default=0, ge=0)
    csharp_compile_ms: int = Field(default=0, ge=0)
    lean_execution_ms: int = Field(default=0, ge=0)
    result_load_ms: int = Field(default=0, ge=0)
    normalization_ms: int = Field(default=0, ge=0)
    evidence_collection_ms: int = Field(default=0, ge=0)
    evidence_validation_ms: int = Field(default=0, ge=0)
    finalization_ms: int = Field(default=0, ge=0)
    total_ms: int = Field(default=0, ge=0)


class BacktestDiagnostics(BaseModel):
    """Artifact cardinalities and sizes; diagnostic, never strategy semantics."""

    canonical_bytes: int = Field(default=0, ge=0)
    generated_csharp_bytes: int = Field(default=0, ge=0)
    normalized_result_bytes: int = Field(default=0, ge=0)
    equity_points: int = Field(default=0, ge=0)
    evidence_events: int = Field(default=0, ge=0)
    evidence_bytes: int = Field(default=0, ge=0)
    market_data_cache_hit: bool | None = None
    required_symbols: int = Field(default=0, ge=0)
    unavailable_symbols: int = Field(default=0, ge=0)


class LeanBacktestResponse(BaseModel):
    strategy_hash: str
    engine: Literal["lean"] = "lean"
    config: BacktestConfig
    result: BacktestResult
    timings: BacktestTimings = Field(default_factory=BacktestTimings)
    diagnostics: BacktestDiagnostics = Field(default_factory=BacktestDiagnostics)
