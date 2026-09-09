from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile
from typing import Any

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.core.selection import select_symbols
from ruletrade.strategy.models import RandomNSelection
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy
from ruletrade.strategy.v1.randomness import deterministic_random_seed


TARGET_PATTERN = re.compile(
    r"RULETRADE_TARGETS\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|selected=(?P<selected>[A-Z0-9.,_:-]*)"
    r"\|weights=(?P<weights>[A-Z0-9.,_=:-]*)"
)
FATAL_PATTERNS = (
    "error::",
    "the security does not have an accurate price",
    "runtime error",
    "algorithm.runtimeerror",
    "algorithm state changed",
    "unhandled exception",
)
INTEREST_RATE_WARNING = "InterestRateProvider.FromCsvFile(): no interest rates were loaded"
COMPLETION_PATTERN = re.compile(
    r"algorithm id:.*completed|algorithmmanager\.run\(\): firing on end of algorithm|backtest completed",
    re.IGNORECASE,
)
FAILED_DATA_REQUESTS_PATTERN = re.compile(
    r"Failed data requests[ \t]*:?[ \t]*(?P<count>\d+)", re.IGNORECASE
)
DIVISION_DERIVED_SCORE_TOLERANCE = Decimal("1e-24")


@dataclass(frozen=True)
class TargetRecord:
    event_identity: str
    selected: tuple[str, ...]
    weights: dict[str, Decimal]


@dataclass(frozen=True)
class E2EValidationResult:
    monthly_events: int
    total_orders: int
    interest_rate_fixture_warning: bool


def validate_lean_completion(log_text: str) -> None:
    """Reject known fatal output and require LEAN's completion marker."""

    lowered = log_text.lower()
    fatal = next((pattern for pattern in FATAL_PATTERNS if pattern in lowered), None)
    if fatal is not None:
        raise ValueError(f"fatal LEAN execution error found: {fatal}")
    if COMPLETION_PATTERN.search(log_text) is None:
        raise ValueError("LEAN backtest completion marker was not found")


def validate_zero_failed_data_requests(log_text: str) -> None:
    """Require the LEAN data-request summary and an exact zero count."""

    match = FAILED_DATA_REQUESTS_PATTERN.search(log_text)
    if match is None:
        raise ValueError("LEAN data-request summary is missing")
    if int(match.group("count")) != 0:
        raise ValueError(f"LEAN reported {match.group('count')} failed data requests")


def parse_symbols(value: str) -> tuple[str, ...]:
    return tuple(value.split(",")) if value else ()


def parse_decimal_map(value: str) -> dict[str, Decimal]:
    if not value:
        return {}
    return {
        key: Decimal(decimal)
        for key, decimal in (item.split("=", 1) for item in value.split(","))
    }


def division_derived_scores_match(
    actual: dict[str, Decimal],
    expected: dict[str, Decimal],
) -> bool:
    """Compare only division-derived cross-runtime scores with a narrow tolerance."""

    return actual.keys() == expected.keys() and all(
        abs(actual[symbol] - expected[symbol]) <= DIVISION_DERIVED_SCORE_TOLERANCE
        for symbol in expected
    )


def load_aligned_daily_closes(
    fixture: Path,
    symbols: tuple[str, ...],
    *,
    fixture_name: str,
) -> tuple[list[str], dict[str, list[Decimal]]]:
    """Load the identical LEAN Daily ZIP shape shared by compiler-slice fixtures."""

    dates: list[str] = []
    closes: dict[str, list[Decimal]] = {}
    for symbol in symbols:
        lower = symbol.lower()
        archive_path = fixture / "equity" / "usa" / "daily" / f"{lower}.zip"
        with ZipFile(archive_path) as archive:
            rows = [
                row.split(",")
                for row in archive.read(f"{lower}.csv").decode().splitlines()
            ]
        observed_dates = [row[0][:8] for row in rows]
        if dates and observed_dates != dates:
            raise ValueError(f"{fixture_name} fixture assets must have aligned Daily bars")
        dates = observed_dates
        closes[symbol] = [Decimal(row[4]) for row in rows]
    return dates, closes


def parse_target_records(log_text: str) -> tuple[TargetRecord, ...]:
    records: dict[str, TargetRecord] = {}
    for match in TARGET_PATTERN.finditer(log_text):
        event_identity = match.group("event")
        record = TargetRecord(
            event_identity=event_identity,
            selected=(
                tuple(sorted(match.group("selected").split(",")))
                if match.group("selected")
                else ()
            ),
            weights=parse_decimal_map(match.group("weights")),
        )
        existing = records.get(event_identity)
        if existing is not None and existing != record:
            raise ValueError(f"conflicting targets for event {event_identity}")
        records[event_identity] = record
    return tuple(records[key] for key in sorted(records))


def _find_statistics(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if "Total Orders" in value:
            return value
        for child in value.values():
            found = _find_statistics(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_statistics(child)
            if found is not None:
                return found
    return None


def _total_orders(result_payload: Any) -> int:
    statistics = _find_statistics(result_payload)
    if statistics is None:
        raise ValueError("LEAN result does not contain Total Orders")
    match = re.search(r"\d+", str(statistics["Total Orders"]).replace(",", ""))
    if match is None:
        raise ValueError("LEAN Total Orders is not numeric")
    return int(match.group())


def validate_golden_e2e(
    log_text: str,
    result_payload: Any,
    *,
    expected_events: int = 12,
    expected_first_event: str = "2024-01-02",
) -> E2EValidationResult:
    validate_lean_completion(log_text)

    records = parse_target_records(log_text)
    if len(records) != expected_events:
        raise ValueError(f"expected {expected_events} monthly events, got {len(records)}")
    if not records or records[0].event_identity != expected_first_event:
        actual = "none" if not records else records[0].event_identity
        raise ValueError(f"expected first monthly rebalance {expected_first_event}, got {actual}")

    strategy = golden_portfolio_strategy()
    plan = compile_strategy_to_lean_plan(strategy)
    selection = plan.random_selections[0]
    growth_sleeve = next(item for item in plan.target_sleeves if item.selection_id == selection.id)
    safe_sleeve = next(item for item in plan.target_sleeves if item.selection_id is None)
    for record in records:
        seed = deterministic_random_seed(
            strategy,
            selection.component_id,
            event_identity=record.event_identity,
        )
        expected_selected = tuple(
            select_symbols(
                list(selection.symbols),
                RandomNSelection(count=selection.count, resample=selection.resample),
                seed=seed,
            )
        )
        if record.selected != expected_selected:
            raise ValueError(f"v0 selection mismatch for {record.event_identity}")
        expected_weights = {
            **{
                symbol: growth_sleeve.total_weight / Decimal(selection.count)
                for symbol in expected_selected
            },
            **{
                symbol: safe_sleeve.total_weight / Decimal(len(safe_sleeve.symbols))
                for symbol in safe_sleeve.symbols
            },
        }
        if record.weights != expected_weights:
            raise ValueError(f"target weight mismatch for {record.event_identity}")
        if sum(record.weights.values(), Decimal(0)) != Decimal(1):
            raise ValueError(f"target weights do not sum to 1 for {record.event_identity}")

    total_orders = _total_orders(result_payload)
    if total_orders <= 0:
        raise ValueError("LEAN backtest submitted no orders")

    return E2EValidationResult(
        monthly_events=len(records),
        total_orders=total_orders,
        interest_rate_fixture_warning=INTEREST_RATE_WARNING in log_text,
    )
