from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import COMPLETION_PATTERN, FATAL_PATTERNS, parse_target_records
from ruletrade.strategy.v1.momentum import evaluate_filtered_trailing_return_top_n

SYMBOLS = ("QQQ", "VGT", "SOXX", "SCHG")
FILTER_PATTERN = re.compile(
    r"RULETRADE_FILTER\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|threshold=(?P<threshold>[-+0-9.Ee]+)"
    r"\|eligible=(?P<eligible>[A-Z0-9,]*)"
    r"\|rejected=(?P<rejected>[A-Z0-9,]*)"
)
MOMENTUM_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|scores=(?P<scores>[A-Z0-9.,_=:+-]+)"
    r"\|ranked=(?P<ranked>[A-Z0-9,]*)"
    r"\|selected=(?P<selected>[A-Z0-9,]*)"
)
SKIPPED_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM_SKIPPED\|(?P<event>\d{4}-\d{2}-\d{2})\|eligible=(?P<count>\d+)"
)


def _split_symbols(value: str) -> tuple[str, ...]:
    return tuple(value.split(",")) if value else ()


def _fixture_closes(fixture: Path) -> tuple[list[str], dict[str, list[Decimal]]]:
    closes: dict[str, list[Decimal]] = {}
    dates: list[str] = []
    for symbol in SYMBOLS:
        lower = symbol.lower()
        with ZipFile(fixture / "equity" / "usa" / "daily" / f"{lower}.zip") as archive:
            rows = [row.split(",") for row in archive.read(f"{lower}.csv").decode().splitlines()]
        observed_dates = [row[0][:8] for row in rows]
        if dates and observed_dates != dates:
            raise ValueError("Filter fixture assets must have aligned Daily bars")
        dates = observed_dates
        closes[symbol] = [Decimal(row[4]) for row in rows]
    return dates, closes


def verify_filter_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, int, int]:
    lowered = log_text.lower()
    fatal = next((pattern for pattern in FATAL_PATTERNS if pattern in lowered), None)
    if fatal or COMPLETION_PATTERN.search(log_text) is None:
        raise ValueError(f"LEAN did not complete cleanly: {fatal or 'completion marker missing'}")
    filters = {match.group("event"): match for match in FILTER_PATTERN.finditer(log_text)}
    momentums = {match.group("event"): match for match in MOMENTUM_PATTERN.finditer(log_text)}
    skipped = {match.group("event"): match for match in SKIPPED_PATTERN.finditer(log_text)}
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    if len(filters) != 12 or len(momentums) != 12:
        raise ValueError(
            f"expected 12 Filter events, got filters={len(filters)}, momentum={len(momentums)}"
        )

    dates, closes = _fixture_closes(fixture)
    successful = 0
    for event_identity, filter_trace in sorted(filters.items()):
        compact_date = event_identity.replace("-", "")
        index = dates.index(compact_date)
        reference = evaluate_filtered_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            threshold=Decimal(0),
            count=2,
        )
        momentum_trace = momentums[event_identity]
        actual_scores = {
            symbol: Decimal(value)
            for symbol, value in (
                item.split("=", 1) for item in momentum_trace.group("scores").split(",")
            )
        }
        for symbol, expected in reference.scores:
            if abs(actual_scores[symbol] - expected) > Decimal("1e-24"):
                raise ValueError(f"score mismatch for {event_identity} {symbol}")
        if Decimal(filter_trace.group("threshold")) != 0:
            raise ValueError(f"threshold mismatch for {event_identity}")
        if _split_symbols(filter_trace.group("eligible")) != reference.eligible:
            raise ValueError(f"eligible-set mismatch for {event_identity}")
        if _split_symbols(filter_trace.group("rejected")) != reference.rejected:
            raise ValueError(f"rejected-set mismatch for {event_identity}")
        if _split_symbols(momentum_trace.group("ranked")) != reference.ranked:
            raise ValueError(f"ranking mismatch for {event_identity}")
        if _split_symbols(momentum_trace.group("selected")) != reference.selected:
            raise ValueError(f"selection mismatch for {event_identity}")
        target = targets.get(event_identity)
        if reference.selected:
            successful += 1
            if target is None or target.selected != tuple(sorted(reference.selected)):
                raise ValueError(f"target selection mismatch for {event_identity}")
            if target.weights != dict(reference.targets):
                raise ValueError(f"target weights mismatch for {event_identity}")
            if event_identity in skipped:
                raise ValueError(f"successful event was marked skipped: {event_identity}")
        else:
            if target is not None:
                raise ValueError(f"skipped event emitted targets: {event_identity}")
            if int(skipped[event_identity].group("count")) != len(reference.eligible):
                raise ValueError(f"skip count mismatch for {event_identity}")

    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("Filter backtest submitted no orders")
    return len(filters), successful, len(skipped), normalized.total_orders
