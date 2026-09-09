from __future__ import annotations

import re
from decimal import Decimal
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
from ruletrade.compiler.lean.evidence_e2e import evidence_for_source, index_decision_evidence
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


def verify_sleeves_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, int, int]:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)

    filters = {match.group("event"): match for match in FILTER_PATTERN.finditer(log_text)}
    primaries = {match.group("event"): match for match in PRIMARY_PATTERN.finditer(log_text)}
    fallbacks = {match.group("event"): match for match in FALLBACK_PATTERN.finditer(log_text)}
    finals = {match.group("event"): match for match in FINAL_PATTERN.finditer(log_text)}
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    sleeve_traces: dict[str, dict[str, re.Match[str]]] = {}
    evidence = index_decision_evidence(log_text)
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
        actual_scores = parse_decimal_map(primary_trace.group("scores"))
        if not division_derived_scores_match(
            actual_scores,
            dict(reference.growth.scores),
        ):
            raise ValueError(f"score mismatch for {event}")
        if parse_symbols(filter_trace.group("eligible")) != reference.growth.eligible:
            raise ValueError(f"eligible mismatch for {event}")
        if parse_symbols(filter_trace.group("rejected")) != reference.growth.rejected:
            raise ValueError(f"rejected mismatch for {event}")
        if parse_symbols(primary_trace.group("ranked")) != reference.growth.ranked:
            raise ValueError(f"ranking mismatch for {event}")
        if parse_symbols(primary_trace.group("candidate")) != reference.growth.candidate:
            raise ValueError(f"candidate mismatch for {event}")
        if parse_symbols(primary_trace.group("selected")) != reference.growth.primary_selected:
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
        if parse_symbols(final_trace.group("selected")) != reference.growth.final_selected:
            raise ValueError(f"Growth final selection mismatch for {event}")
        if Decimal(filter_trace.group("threshold")) != 0:
            raise ValueError(f"filter threshold mismatch for {event}")

        traces = sleeve_traces[event]
        if set(traces) != {"growth_sleeve", "defensive_sleeve"}:
            raise ValueError(f"sleeve provenance mismatch for {event}")
        for sleeve in reference.sleeves:
            actual = traces[sleeve.sleeve_id]
            if parse_symbols(actual.group("selected")) != tuple(sorted(sleeve.local_selected)):
                raise ValueError(f"local selection mismatch for {event} {sleeve.sleeve_id}")
            if parse_decimal_map(actual.group("local")) != dict(sleeve.local_targets):
                raise ValueError(f"local targets mismatch for {event} {sleeve.sleeve_id}")
            if Decimal(actual.group("allocation")) != sleeve.allocation:
                raise ValueError(f"allocation mismatch for {event} {sleeve.sleeve_id}")
            if parse_decimal_map(actual.group("scaled")) != dict(sleeve.scaled_targets):
                raise ValueError(f"scaled targets mismatch for {event} {sleeve.sleeve_id}")
            if evidence:
                structured = evidence_for_source(
                    evidence,
                    event,
                    "sleeve_contribution",
                    "sleeve",
                    sleeve.sleeve_id,
                ).evidence
                if (
                    structured.local_selected != tuple(sorted(sleeve.local_selected))
                    or structured.local_targets != dict(sleeve.local_targets)
                    or structured.allocation != sleeve.allocation
                    or structured.scaled_targets != dict(sleeve.scaled_targets)
                ):
                    raise ValueError(
                        f"structured sleeve evidence mismatch for {event} {sleeve.sleeve_id}"
                    )
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
