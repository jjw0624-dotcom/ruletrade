from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import (
    division_derived_scores_match,
    load_aligned_daily_closes,
    parse_decimal_map,
    parse_symbols,
    parse_target_records,
    validate_lean_completion,
)
from ruletrade.compiler.lean.evidence_e2e import index_decision_evidence, one_evidence
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
    r"\|candidate=(?P<candidate>[A-Z0-9,]*)"
    r"\|selected=(?P<selected>[A-Z0-9,]*)"
    r"\|decision=(?P<decision>executed|skipped)"
)
SKIPPED_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM_SKIPPED\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|eligible=(?P<eligible>\d+)\|required=(?P<required>\d+)"
)


def load_filter_fixture_closes(
    fixture: Path,
) -> tuple[list[str], dict[str, list[Decimal]]]:
    return load_aligned_daily_closes(fixture, SYMBOLS, fixture_name="Filter")


def verify_filter_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, int, int]:
    validate_lean_completion(log_text)
    filters = {match.group("event"): match for match in FILTER_PATTERN.finditer(log_text)}
    momentums = {match.group("event"): match for match in MOMENTUM_PATTERN.finditer(log_text)}
    skipped = {match.group("event"): match for match in SKIPPED_PATTERN.finditer(log_text)}
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    evidence = index_decision_evidence(log_text)
    if len(filters) != 12 or len(momentums) != 12:
        raise ValueError(
            f"expected 12 Filter events, got filters={len(filters)}, momentum={len(momentums)}"
        )

    dates, closes = load_filter_fixture_closes(fixture)
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
        actual_scores = parse_decimal_map(momentum_trace.group("scores"))
        if not division_derived_scores_match(actual_scores, dict(reference.scores)):
            raise ValueError(f"score mismatch for {event_identity}")
        if Decimal(filter_trace.group("threshold")) != 0:
            raise ValueError(f"threshold mismatch for {event_identity}")
        if parse_symbols(filter_trace.group("eligible")) != reference.eligible:
            raise ValueError(f"eligible-set mismatch for {event_identity}")
        if parse_symbols(filter_trace.group("rejected")) != reference.rejected:
            raise ValueError(f"rejected-set mismatch for {event_identity}")
        if parse_symbols(momentum_trace.group("ranked")) != reference.ranked:
            raise ValueError(f"ranking mismatch for {event_identity}")
        if parse_symbols(momentum_trace.group("candidate")) != reference.ranked[:2]:
            raise ValueError(f"candidate mismatch for {event_identity}")
        if parse_symbols(momentum_trace.group("selected")) != reference.selected:
            raise ValueError(f"selection mismatch for {event_identity}")
        if evidence:
            filter_evidence = one_evidence(evidence, event_identity, "filter").evidence
            actual_evaluations = {
                item.asset: (item.observed, item.passed)
                for item in filter_evidence.evaluations
            }
            expected_evaluations = {
                asset: (score, asset in reference.eligible)
                for asset, score in reference.scores
            }
            if not division_derived_scores_match(
                {asset: value[0] for asset, value in actual_evaluations.items()},
                {asset: value[0] for asset, value in expected_evaluations.items()},
            ) or {
                asset: value[1] for asset, value in actual_evaluations.items()
            } != {
                asset: value[1] for asset, value in expected_evaluations.items()
            }:
                raise ValueError(f"structured filter evidence mismatch for {event_identity}")
            selection_evidence = one_evidence(
                evidence, event_identity, "selection"
            ).evidence
            if (
                selection_evidence.ranked != reference.ranked
                or selection_evidence.candidates != reference.ranked[:2]
                or selection_evidence.primary_selected != reference.selected
            ):
                raise ValueError(f"structured selection evidence mismatch for {event_identity}")
        expected_decision = "executed" if reference.selected else "skipped"
        if momentum_trace.group("decision") != expected_decision:
            raise ValueError(f"decision mismatch for {event_identity}")
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
            if event_identity not in skipped:
                raise ValueError(f"skipped event was not marked skipped: {event_identity}")
            if int(skipped[event_identity].group("eligible")) != len(reference.eligible):
                raise ValueError(f"skip count mismatch for {event_identity}")
            if int(skipped[event_identity].group("required")) != 2:
                raise ValueError(f"required count mismatch for {event_identity}")

    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("Filter backtest submitted no orders")
    return len(filters), successful, len(skipped), normalized.total_orders
