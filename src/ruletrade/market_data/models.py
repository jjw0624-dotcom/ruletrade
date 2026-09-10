from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.backtests.models import BacktestConfig


class MarketDataModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MarketDataSymbolRequirement(MarketDataModel):
    symbol: str
    security_type: Literal["equity"] = "equity"
    market: Literal["usa"] = "usa"
    resolution: Literal["daily"] = "daily"
    warmup_observations: int = Field(ge=0)


class MarketDataRequirement(MarketDataModel):
    dataset_id: str
    requested_start: date
    requested_end: date
    normalization_mode: Literal["adjusted"] = "adjusted"
    symbols: tuple[MarketDataSymbolRequirement, ...]


class MarketDataSymbolAvailability(MarketDataModel):
    symbol: str
    status: Literal["available", "unavailable"]
    reason: Literal[
        "available",
        "provider_unavailable",
        "no_data",
        "security_master_missing",
        "insufficient_history",
        "requested_period_unavailable",
        "corrupt_cache",
    ]
    available_from: date | None = None
    available_to: date | None = None
    warmup_observations_required: int = Field(ge=0)
    warmup_observations_available: int = Field(ge=0)


class MarketDataPreflight(MarketDataModel):
    overall: Literal["available", "partial", "unavailable"]
    dataset_id: str
    source_kind: Literal["synthetic_fixture", "local_lean_data"]
    provider_id: str
    requirement: MarketDataRequirement
    symbols: tuple[MarketDataSymbolAvailability, ...]
    cache_hit: bool
    acquisition_supported: bool = False
    acquisition_reason: str | None = None
    elapsed_ms: int = Field(ge=0)


class MarketDataPreflightRequest(MarketDataModel):
    config: BacktestConfig
