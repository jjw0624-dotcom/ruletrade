from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import COMPLETION_PATTERN, FATAL_PATTERNS, parse_target_records
from ruletrade.compiler.lean.fallback_e2e import (
    FAILED_DATA_REQUESTS_PATTERN,
    FALLBACK_PATTERN,
    FINAL_PATTERN,
    PRIMARY_PATTERN,
)
from ruletrade.compiler.lean.filter_e2e import FILTER_PATTERN, load_filter_fixture_closes
from ruletrade.strategy.v1.momentum import evaluate_portfolio_sleeves

SLEEVE_PATTERN = re.compile(
    r"RULETRADE_SLEEVE\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|sleeve=(?P<sleeve>[A-Za-z0-9_-]+)"
    r"\|local_selected=(?P<selected>[A-Z0-9,]*)"
    r"\|local_weights=(?P<local>[A-Z0-9.,_=:+-]+)"
    r"\|allocation=(?P<allocation>[-+0-9.Ee]+)"
    r"\|scaled=(?P<scaled>[A-Z0-9.,_=:+-]+)"
)


def _symbols(value: str) -> tuple[str, ...]:
    return tuple(value.split(",")) if value else ()


def _weights(value: str) -> dict[str, Decimal]:
    return {
        symbol: Decimal(weight)
        for symbol, weight in (item.split("=", 1) for item in value.split(","))
    }


def verify_sleeves_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, int, int]:
    lowered = log_text.lower()
    fatal = next((pattern for pattern in FATAL_PATTERNS if pattern in lowered), None)
    if fatal or COMPLETION_PATTERN.search(log_text) is None:
        raise ValueError(f"LEAN did not complete cleanly: {fatal or 'completion marker missing'}")
    failed = FAILED_DATA_REQUESTS_PATTERN.search(log_text)
    if failed is None or int(failed.group("count")) != 0:
        raise ValueError("LEAN must report zero failed data requests")

    filters = {match.group("event"): match for match in FILTER_PATTERN.finditer(log_text)}
    primaries = {match.group("event"): match for match in PRIMARY_PATTERN.finditer(log_text)}
    fallbacks = {match.group("event"): match for match in FALLBACK_PATTERN.finditer(log_text)}
    finals = {match.group("event"): match for match in FINAL_PATTERN.finditer(log_text)}
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    sleeve_traces: dict[str, dict[str, re.Match[str]]] = {}
    for match in SLEEVE_PATTERN.finditer(log_text):
        sleeve_traces.setdefault(match.group("event"), {})[match.group("sleeve")] = match
    trace_counts = {
        len(filters), len(primaries), len(fallbacks), len(finals), len(targets),
        len(sleeve_traces),
    }
    if trace_counts != {12}:
        raise ValueError("expected 12 complete Portfolio Sleeve trace groups")

    dates, closes = load_filter_fixture_closes(fixture)
    primary_count = fallback_count = 0
    for event, filter_trace in sorted(filters.items()):
        index = dates.index(event.replace("-", ""))
        reference = evaluate_portfolio_sleeves(
            {symbol: values[: index + 1] for symbol, values in closes.items()}
        )
        primary_trace = primaries[event]
        fallback_trace = fallbacks[event]
        final_trace = finals[event]
        actual_scores = _weights(primary_trace.group("scores"))
        for symbol, expected in reference.growth.scores:
            if abs(actual_scores[symbol] - expected) > Decimal("1e-24"):
                raise ValueError(f"score mismatch for {event} {symbol}")
        if _symbols(filter_trace.group("eligible")) != reference.growth.eligible:
            raise ValueError(f"eligible mismatch for {event}")
        if _symbols(filter_trace.group("rejected")) != reference.growth.rejected:
            raise ValueError(f"rejected mismatch for {event}")
        if _symbols(primary_trace.group("ranked")) != reference.growth.ranked:
            raise ValueError(f"ranking mismatch for {event}")
        if _symbols(primary_trace.group("candidate")) != reference.growth.candidate:
            raise ValueError(f"candidate mismatch for {event}")
        if _symbols(primary_trace.group("selected")) != reference.growth.primary_selected:
            raise ValueError(f"primary selection mismatch for {event}")
        expected_primary = (
            "insufficient" if reference.growth.fallback_activated else "executed"
        )
        if primary_trace.group("decision") != expected_primary:
            raise ValueError(f"primary decision mismatch for {event}")
        expected_fallback = "activated" if reference.growth.fallback_activated else "not_activated"
        if fallback_trace.group("component") != "fallback" or fallback_trace.group("asset") != "TLT":
            raise ValueError(f"fallback provenance mismatch for {event}")
        if fallback_trace.group("decision") != expected_fallback:
            raise ValueError(f"fallback decision mismatch for {event}")
        expected_source = "fallback" if reference.growth.fallback_activated else "primary"
        if final_trace.group("source") != expected_source:
            raise ValueError(f"final source mismatch for {event}")
        if _symbols(final_trace.group("selected")) != reference.growth.final_selected:
            raise ValueError(f"Growth final selection mismatch for {event}")
        if Decimal(filter_trace.group("threshold")) != 0:
            raise ValueError(f"filter threshold mismatch for {event}")

        traces = sleeve_traces[event]
        if set(traces) != {"growth_sleeve", "defensive_sleeve"}:
            raise ValueError(f"sleeve provenance mismatch for {event}")
        for sleeve in reference.sleeves:
            actual = traces[sleeve.sleeve_id]
            if _symbols(actual.group("selected")) != tuple(sorted(sleeve.local_selected)):
                raise ValueError(f"local selection mismatch for {event} {sleeve.sleeve_id}")
            if _weights(actual.group("local")) != dict(sleeve.local_targets):
                raise ValueError(f"local targets mismatch for {event} {sleeve.sleeve_id}")
            if Decimal(actual.group("allocation")) != sleeve.allocation:
                raise ValueError(f"allocation mismatch for {event} {sleeve.sleeve_id}")
            if _weights(actual.group("scaled")) != dict(sleeve.scaled_targets):
                raise ValueError(f"scaled targets mismatch for {event} {sleeve.sleeve_id}")
        target = targets[event]
        if target.selected != reference.final_selected:
            raise ValueError(f"final selected-symbol mismatch for {event}")
        if target.weights != dict(reference.final_targets):
            raise ValueError(f"aggregated targets mismatch for {event}")
        if reference.growth.fallback_activated:
            fallback_count += 1
        else:
            primary_count += 1

    if (primary_count, fallback_count) != (7, 5):
        raise ValueError("expected primary=7 and fallback=5")
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("Portfolio Sleeves backtest submitted no orders")
    return 12, primary_count, fallback_count, normalized.total_orders
