from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import COMPLETION_PATTERN, FATAL_PATTERNS, parse_target_records
from ruletrade.compiler.lean.filter_e2e import FILTER_PATTERN, load_filter_fixture_closes
from ruletrade.strategy.v1.momentum import evaluate_fallback_trailing_return_top_n

PRIMARY_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|scores=(?P<scores>[A-Z0-9.,_=:+-]+)"
    r"\|ranked=(?P<ranked>[A-Z0-9,]*)"
    r"\|candidate=(?P<candidate>[A-Z0-9,]*)"
    r"\|selected=(?P<selected>[A-Z0-9,]*)"
    r"\|decision=(?P<decision>executed|insufficient)"
)
FALLBACK_PATTERN = re.compile(
    r"RULETRADE_FALLBACK\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|component=(?P<component>[A-Za-z0-9_-]+)"
    r"\|asset=(?P<asset>[A-Z0-9._:-]+)"
    r"\|decision=(?P<decision>activated|not_activated)"
)
FINAL_PATTERN = re.compile(
    r"RULETRADE_FINAL\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|selected=(?P<selected>[A-Z0-9,]+)"
    r"\|decision=executed\|source=(?P<source>primary|fallback)"
)
FAILED_DATA_REQUESTS_PATTERN = re.compile(
    r"Failed data requests[ \t]*:?[ \t]*(?P<count>\d+)", re.IGNORECASE
)


def _split_symbols(value: str) -> tuple[str, ...]:
    return tuple(value.split(",")) if value else ()


def verify_fallback_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, int, int]:
    lowered = log_text.lower()
    fatal = next((pattern for pattern in FATAL_PATTERNS if pattern in lowered), None)
    if fatal or COMPLETION_PATTERN.search(log_text) is None:
        raise ValueError(f"LEAN did not complete cleanly: {fatal or 'completion marker missing'}")
    failed_data_requests = FAILED_DATA_REQUESTS_PATTERN.search(log_text)
    if failed_data_requests is None:
        raise ValueError("LEAN data-request summary is missing")
    if int(failed_data_requests.group("count")) != 0:
        raise ValueError(
            f"LEAN reported {failed_data_requests.group('count')} failed data requests"
        )

    filters = {match.group("event"): match for match in FILTER_PATTERN.finditer(log_text)}
    primaries = {match.group("event"): match for match in PRIMARY_PATTERN.finditer(log_text)}
    fallbacks = {match.group("event"): match for match in FALLBACK_PATTERN.finditer(log_text)}
    finals = {match.group("event"): match for match in FINAL_PATTERN.finditer(log_text)}
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    counts = {len(filters), len(primaries), len(fallbacks), len(finals), len(targets)}
    if counts != {12}:
        raise ValueError(
            "expected 12 Fallback events for every trace, got "
            f"filter={len(filters)}, primary={len(primaries)}, fallback={len(fallbacks)}, "
            f"final={len(finals)}, targets={len(targets)}"
        )
    if "RULETRADE_MOMENTUM_SKIPPED|" in log_text:
        raise ValueError("Fallback strategy emitted a skipped-rebalance trace")

    dates, closes = load_filter_fixture_closes(fixture)
    primary_count = fallback_count = 0
    for event_identity, filter_trace in sorted(filters.items()):
        compact_date = event_identity.replace("-", "")
        index = dates.index(compact_date)
        reference = evaluate_fallback_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            threshold=Decimal(0),
            count=2,
            fallback_asset="TLT",
        )
        primary_trace = primaries[event_identity]
        fallback_trace = fallbacks[event_identity]
        final_trace = finals[event_identity]
        actual_scores = {
            symbol: Decimal(value)
            for symbol, value in (
                item.split("=", 1) for item in primary_trace.group("scores").split(",")
            )
        }
        if set(actual_scores) != {symbol for symbol, _ in reference.scores}:
            raise ValueError(f"score symbol mismatch for {event_identity}")
        for symbol, expected in reference.scores:
            if abs(actual_scores[symbol] - expected) > Decimal("1e-24"):
                raise ValueError(f"score mismatch for {event_identity} {symbol}")
        if Decimal(filter_trace.group("threshold")) != 0:
            raise ValueError(f"threshold mismatch for {event_identity}")
        if _split_symbols(filter_trace.group("eligible")) != reference.eligible:
            raise ValueError(f"eligible-set mismatch for {event_identity}")
        if _split_symbols(filter_trace.group("rejected")) != reference.rejected:
            raise ValueError(f"rejected-set mismatch for {event_identity}")
        if _split_symbols(primary_trace.group("ranked")) != reference.ranked:
            raise ValueError(f"ranking mismatch for {event_identity}")
        if _split_symbols(primary_trace.group("candidate")) != reference.candidate:
            raise ValueError(f"candidate mismatch for {event_identity}")
        if _split_symbols(primary_trace.group("selected")) != reference.primary_selected:
            raise ValueError(f"primary selection mismatch for {event_identity}")

        expected_primary_decision = (
            "insufficient" if reference.fallback_activated else "executed"
        )
        if primary_trace.group("decision") != expected_primary_decision:
            raise ValueError(f"primary decision mismatch for {event_identity}")
        expected_fallback_decision = (
            "activated" if reference.fallback_activated else "not_activated"
        )
        if fallback_trace.group("component") != "fallback":
            raise ValueError(f"fallback provenance mismatch for {event_identity}")
        if fallback_trace.group("asset") != "TLT":
            raise ValueError(f"fallback asset mismatch for {event_identity}")
        if fallback_trace.group("decision") != expected_fallback_decision:
            raise ValueError(f"fallback decision mismatch for {event_identity}")

        expected_source = "fallback" if reference.fallback_activated else "primary"
        if _split_symbols(final_trace.group("selected")) != reference.final_selected:
            raise ValueError(f"final selection mismatch for {event_identity}")
        if final_trace.group("source") != expected_source:
            raise ValueError(f"final source mismatch for {event_identity}")
        target = targets[event_identity]
        if target.selected != tuple(sorted(reference.final_selected)):
            raise ValueError(f"target selection mismatch for {event_identity}")
        if target.weights != dict(reference.final_targets):
            raise ValueError(f"target weights mismatch for {event_identity}")

        if reference.fallback_activated:
            fallback_count += 1
        else:
            primary_count += 1

    if (primary_count, fallback_count) != (7, 5):
        raise ValueError(
            f"expected primary=7 and fallback=5, got {primary_count} and {fallback_count}"
        )
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("Fallback backtest submitted no orders")
    return len(filters), primary_count, fallback_count, normalized.total_orders
