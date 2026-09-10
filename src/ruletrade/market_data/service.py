from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from time import perf_counter_ns
from zipfile import BadZipFile, ZipFile

from ruletrade.backtests.errors import MarketDataUnavailableError
from ruletrade.backtests.models import BacktestConfig
from ruletrade.compiler import analyze_strategy_requirements
from ruletrade.diagnostics import elapsed_ms
from ruletrade.market_data.models import (
    MarketDataPreflight,
    MarketDataRequirement,
    MarketDataSymbolAvailability,
    MarketDataSymbolRequirement,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1

FIXTURE_DATASETS = frozenset(
    {"golden-synthetic", "filter-synthetic", "cooldown-synthetic"}
)
REAL_DATASET_ID = "us-equity-daily-local"


def default_lean_data_dir() -> Path | None:
    configured = os.getenv("RULETRADE_LEAN_DATA_DIR")
    return Path(configured).expanduser().resolve() if configured else None


class MarketDataService:
    """Derive requirements and inspect a configured LEAN-compatible local cache."""

    def __init__(self, lean_data_dir: Path | None = None) -> None:
        self.lean_data_dir = lean_data_dir

    def derive_requirement(
        self, strategy: CanonicalStrategyV1, config: BacktestConfig
    ) -> MarketDataRequirement:
        compiler_requirements = analyze_strategy_requirements(strategy)
        warmups = {symbol: 0 for symbol in compiler_requirements.assets}
        for history in compiler_requirements.daily_history:
            for symbol in history.symbols:
                warmups[symbol] = max(warmups.get(symbol, 0), history.lookback_bars)
        return MarketDataRequirement(
            dataset_id=config.dataset_id,
            requested_start=config.start_date,
            requested_end=config.end_date,
            symbols=tuple(
                MarketDataSymbolRequirement(
                    symbol=symbol,
                    warmup_observations=warmups[symbol],
                )
                for symbol in sorted(warmups)
            ),
        )

    def preflight(
        self, strategy: CanonicalStrategyV1, config: BacktestConfig
    ) -> MarketDataPreflight:
        started = perf_counter_ns()
        requirement = self.derive_requirement(strategy, config)
        if config.dataset_id in FIXTURE_DATASETS:
            available = tuple(
                MarketDataSymbolAvailability(
                    symbol=item.symbol,
                    status="available",
                    reason="available",
                    warmup_observations_required=item.warmup_observations,
                    warmup_observations_available=item.warmup_observations,
                )
                for item in requirement.symbols
            )
            return MarketDataPreflight(
                overall="available",
                dataset_id=config.dataset_id,
                source_kind="synthetic_fixture",
                provider_id="ruletrade-fixture",
                requirement=requirement,
                symbols=available,
                cache_hit=True,
                elapsed_ms=elapsed_ms(started),
            )

        root = self.lean_data_dir or default_lean_data_dir()
        if root is None or not root.is_dir():
            unavailable = tuple(
                self._unavailable(item, "provider_unavailable")
                for item in requirement.symbols
            )
            return self._result(requirement, unavailable, started)
        outcomes = tuple(self._inspect_symbol(root, item, config) for item in requirement.symbols)
        return self._result(requirement, outcomes, started)

    def require_available(
        self, strategy: CanonicalStrategyV1, config: BacktestConfig
    ) -> MarketDataPreflight:
        result = self.preflight(strategy, config)
        if result.overall != "available":
            missing = ", ".join(
                f"{item.symbol}:{item.reason}"
                for item in result.symbols
                if item.status != "available"
            )
            raise MarketDataUnavailableError(
                f"Required market data is unavailable ({missing})."
            )
        return result

    def _result(self, requirement, symbols, started) -> MarketDataPreflight:
        available_count = sum(item.status == "available" for item in symbols)
        if available_count == len(symbols):
            overall = "available"
        elif available_count:
            overall = "partial"
        else:
            overall = "unavailable"
        return MarketDataPreflight(
            overall=overall,
            dataset_id=requirement.dataset_id,
            source_kind="local_lean_data",
            provider_id="quantconnect-lean-local",
            requirement=requirement,
            symbols=symbols,
            cache_hit=overall == "available",
            acquisition_supported=False,
            acquisition_reason=(
                None
                if overall == "available"
                else "Acquire licensed US Equity data with the authenticated LEAN CLI."
            ),
            elapsed_ms=elapsed_ms(started),
        )

    def _inspect_symbol(self, root, requirement, config):
        symbol = requirement.symbol.lower()
        bars_path = root / "equity" / "usa" / "daily" / f"{symbol}.zip"
        map_path = root / "equity" / "usa" / "map_files" / f"{symbol}.csv"
        factor_path = root / "equity" / "usa" / "factor_files" / f"{symbol}.csv"
        if not bars_path.is_file():
            return self._unavailable(requirement, "no_data")
        if not map_path.is_file() or not factor_path.is_file():
            return self._unavailable(requirement, "security_master_missing")
        try:
            dates = self._read_daily_dates(bars_path)
        except (OSError, BadZipFile, ValueError, UnicodeDecodeError):
            return self._unavailable(requirement, "corrupt_cache")
        if not dates:
            return self._unavailable(requirement, "no_data")
        warmup = sum(item < config.start_date for item in dates)
        common = {
            "symbol": requirement.symbol,
            "available_from": dates[0],
            "available_to": dates[-1],
            "warmup_observations_required": requirement.warmup_observations,
            "warmup_observations_available": warmup,
        }
        if warmup < requirement.warmup_observations:
            return MarketDataSymbolAvailability(
                status="unavailable", reason="insufficient_history", **common
            )
        if dates[-1] < config.end_date or not any(
            config.start_date <= item <= config.end_date for item in dates
        ):
            return MarketDataSymbolAvailability(
                status="unavailable", reason="requested_period_unavailable", **common
            )
        return MarketDataSymbolAvailability(status="available", reason="available", **common)

    @staticmethod
    def _read_daily_dates(path: Path) -> tuple[date, ...]:
        with ZipFile(path) as archive:
            members = [name for name in archive.namelist() if not name.endswith("/")]
            if len(members) != 1:
                raise ValueError("daily archive must contain one data file")
            rows = archive.read(members[0]).decode("utf-8").splitlines()
        raw_dates = (
            row.split(",", 1)[0].split(" ", 1)[0]
            for row in rows
            if row.strip()
        )
        dates = {
            date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
            for raw in raw_dates
        }
        return tuple(sorted(dates))

    @staticmethod
    def _unavailable(requirement, reason):
        return MarketDataSymbolAvailability(
            symbol=requirement.symbol,
            status="unavailable",
            reason=reason,
            warmup_observations_required=requirement.warmup_observations,
            warmup_observations_available=0,
        )
