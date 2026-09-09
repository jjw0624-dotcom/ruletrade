from __future__ import annotations

import re
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import (
    division_derived_scores_match,
    parse_decimal_map,
    parse_symbols,
    parse_target_records,
    validate_lean_completion,
    validate_zero_failed_data_requests,
)
from ruletrade.compiler.lean.fallback_e2e import (
    FALLBACK_PATTERN,
    FINAL_PATTERN,
    PRIMARY_PATTERN,
)
from ruletrade.compiler.lean.filter_e2e import FILTER_PATTERN, load_filter_fixture_closes
from ruletrade.strategy.v1.temporal import evaluate_independent_schedules

REFRESH_PATTERN = re.compile(
    r"RULETRADE_REFRESH\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|sleeve=(?P<sleeve>[A-Za-z0-9_-]+)"
    r"\|schedule=(?P<schedule>monthly|quarterly)"
    r"\|local_targets=(?P<targets>[A-Z0-9.,_=:+-]+)"
    r"\|snapshot=(?P<snapshot>\d{4}-\d{2}-\d{2})"
)
PORTFOLIO_EVENT_PATTERN = re.compile(
    r"RULETRADE_PORTFOLIO_EVENT\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|schedule=quarterly\|snapshots=(?P<snapshots>[A-Za-z0-9_,=-]*)"
    r"\|decision=(?P<decision>executed|skipped)"
)
SLEEVE_PATTERN = re.compile(
    r"RULETRADE_SLEEVE\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|sleeve=(?P<sleeve>[A-Za-z0-9_-]+)"
    r"\|local_selected=(?P<selected>[A-Z0-9,]*)"
    r"\|local_weights=(?P<local>[A-Z0-9.,_=:+-]+)"
    r"\|allocation=(?P<allocation>[-+0-9.Ee]+)"
    r"\|scaled=(?P<scaled>[A-Z0-9.,_=:+-]+)"
)

MONTHLY_EVENTS = (
    "2024-01-02", "2024-02-01", "2024-03-01", "2024-04-01",
    "2024-05-01", "2024-06-03", "2024-07-01", "2024-08-01",
    "2024-09-03", "2024-10-01", "2024-11-01", "2024-12-02",
)


def _snapshots(value: str) -> dict[str, str]:
    if not value:
        return {}
    return dict(item.split("=", 1) for item in value.split(","))


def verify_independent_schedules_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, int, int]:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)

    refreshes: dict[tuple[str, str], re.Match[str]] = {
        (match.group("event"), match.group("sleeve")): match
        for match in REFRESH_PATTERN.finditer(log_text)
    }
    portfolio_events = {
        match.group("event"): match
        for match in PORTFOLIO_EVENT_PATTERN.finditer(log_text)
    }
    sleeves: dict[tuple[str, str], re.Match[str]] = {
        (match.group("event"), match.group("sleeve")): match
        for match in SLEEVE_PATTERN.finditer(log_text)
    }
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    if len(refreshes) != 16 or len(portfolio_events) != 4 or len(targets) != 4:
        raise ValueError("expected 12 Growth, 4 Defensive refreshes, and 4 portfolio events")

    dates, closes = load_filter_fixture_closes(fixture)
    closes_by_event = {
        event: {
            symbol: values[: dates.index(event.replace("-", "")) + 1]
            for symbol, values in closes.items()
        }
        for event in MONTHLY_EVENTS
    }
    reference = evaluate_independent_schedules(MONTHLY_EVENTS, closes_by_event)
    filters = {match.group("event"): match for match in FILTER_PATTERN.finditer(log_text)}
    primaries = {match.group("event"): match for match in PRIMARY_PATTERN.finditer(log_text)}
    finals = {match.group("event"): match for match in FINAL_PATTERN.finditer(log_text)}
    if not (len(filters) == len(primaries) == len(finals) == 12):
        raise ValueError("expected 12 complete Growth decision traces")
    primary = fallback = 0
    for snapshot in reference.refreshes:
        actual = refreshes[(snapshot.refreshed_at, snapshot.sleeve_id)]
        expected_schedule = "monthly" if snapshot.sleeve_id == "growth_sleeve" else "quarterly"
        if actual.group("schedule") != expected_schedule:
            raise ValueError(f"refresh schedule mismatch for {snapshot.refreshed_at}")
        if actual.group("snapshot") != snapshot.refreshed_at:
            raise ValueError(f"snapshot timestamp mismatch for {snapshot.refreshed_at}")
        if parse_decimal_map(actual.group("targets")) != dict(snapshot.local_targets):
            raise ValueError(f"local target mismatch for {snapshot.refreshed_at} {snapshot.sleeve_id}")
        if snapshot.growth_decision is not None:
            decision = snapshot.growth_decision
            primary_trace = primaries[snapshot.refreshed_at]
            filter_trace = filters[snapshot.refreshed_at]
            final_trace = finals[snapshot.refreshed_at]
            if not division_derived_scores_match(
                parse_decimal_map(primary_trace.group("scores")),
                dict(decision.scores),
            ):
                raise ValueError(f"score mismatch for {snapshot.refreshed_at}")
            if parse_symbols(filter_trace.group("eligible")) != decision.eligible:
                raise ValueError(f"eligible mismatch for {snapshot.refreshed_at}")
            if parse_symbols(filter_trace.group("rejected")) != decision.rejected:
                raise ValueError(f"rejected mismatch for {snapshot.refreshed_at}")
            if parse_symbols(primary_trace.group("ranked")) != decision.ranked:
                raise ValueError(f"ranking mismatch for {snapshot.refreshed_at}")
            candidate = parse_symbols(primary_trace.group("candidate"))
            if candidate != decision.candidate:
                raise ValueError(f"candidate mismatch for {snapshot.refreshed_at}")
            actual_primary = parse_symbols(primary_trace.group("selected"))
            if actual_primary != decision.primary_selected:
                raise ValueError(f"primary selection mismatch for {snapshot.refreshed_at}")
            expected_primary = "insufficient" if decision.fallback_activated else "executed"
            if primary_trace.group("decision") != expected_primary:
                raise ValueError(f"primary decision mismatch for {snapshot.refreshed_at}")
            actual_final = parse_symbols(final_trace.group("selected"))
            if actual_final != decision.final_selected:
                raise ValueError(f"final selection mismatch for {snapshot.refreshed_at}")
            actual_fallback = next(
                match for match in FALLBACK_PATTERN.finditer(log_text)
                if match.group("event") == snapshot.refreshed_at
            )
            expected = "activated" if decision.fallback_activated else "not_activated"
            if actual_fallback.group("decision") != expected:
                raise ValueError(f"fallback decision mismatch for {snapshot.refreshed_at}")
            expected_source = "fallback" if decision.fallback_activated else "primary"
            if final_trace.group("source") != expected_source:
                raise ValueError(f"final source mismatch for {snapshot.refreshed_at}")
            fallback += int(decision.fallback_activated)
            primary += int(not decision.fallback_activated)

    for decision in reference.portfolio_events:
        actual = portfolio_events[decision.event]
        if actual.group("decision") != decision.decision:
            raise ValueError(f"portfolio decision mismatch for {decision.event}")
        expected_timestamps = dict(decision.snapshot_timestamps)
        if _snapshots(actual.group("snapshots")) != expected_timestamps:
            raise ValueError(f"portfolio snapshot provenance mismatch for {decision.event}")
        for sleeve_id, contribution in decision.scaled_contributions:
            trace = sleeves[(decision.event, sleeve_id)]
            if parse_decimal_map(trace.group("scaled")) != dict(contribution):
                raise ValueError(f"scaled contribution mismatch for {decision.event} {sleeve_id}")
        target = targets[decision.event]
        if target.weights != dict(decision.final_targets):
            raise ValueError(f"final target mismatch for {decision.event}")
        if target.selected != tuple(symbol for symbol, _ in decision.final_targets):
            raise ValueError(f"final symbol mismatch for {decision.event}")

    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("independent-schedule backtest submitted no orders")
    return len(reference.refreshes), len(reference.portfolio_events), primary, normalized.total_orders
