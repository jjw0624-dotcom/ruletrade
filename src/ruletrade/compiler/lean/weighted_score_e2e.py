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
from ruletrade.compiler.lean.filter_e2e import SYMBOLS, load_filter_fixture_closes
from ruletrade.strategy.v2.corpus import weighted_momentum_allocation_strategy
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.program_execution import execute_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


SCORE_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|scores=(?P<scores>[A-Z0-9.,_=:+-]+)"
    r"\|ranked=(?P<ranked>[A-Z0-9,]*)"
    r"\|selected=(?P<selected>[A-Z0-9,]*)"
)


def verify_weighted_score_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int]:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)
    traces = {match.group("event"): match for match in SCORE_PATTERN.finditer(log_text)}
    targets = {record.event_identity: record for record in parse_target_records(log_text)}
    if not traces or traces.keys() != targets.keys():
        raise ValueError(
            f"weighted Score traces and targets must cover the same decisions: "
            f"scores={len(traces)} targets={len(targets)}"
        )

    dates, closes = load_filter_fixture_closes(fixture)
    snapshot = DailyMarketSnapshot(
        snapshot_id="lean-filter-weighted-score-reference",
        clock=Clock(id="daily-close"),
        dates=tuple(
            f"{value[:4]}-{value[4:6]}-{value[6:8]}" for value in dates
        ),
        domains={"growth": SYMBOLS},
        series={
            symbol: {"close:adjusted": tuple(values)}
            for symbol, values in closes.items()
        },
    )
    program = weighted_momentum_allocation_strategy().program
    assert program is not None
    for event_identity, trace in sorted(traces.items()):
        index = dates.index(event_identity.replace("-", ""))
        reference = execute_program_v2(program, snapshot, cutoff_index=index)
        expected_scores = {
            item.candidate: item.value
            for item in reference.value_observations
            if item.semantic_id == "weighted-momentum-score"
            and item.candidate is not None
            and item.value is not None
        }
        actual_scores = parse_decimal_map(trace.group("scores"))
        if not division_derived_scores_match(actual_scores, expected_scores):
            raise ValueError(f"weighted Score mismatch for {event_identity}")
        expected_ranked = tuple(
            sorted(expected_scores, key=lambda symbol: (-expected_scores[symbol], symbol))
        )
        expected_selected = reference.selection_outputs["selected-growth"]
        if parse_symbols(trace.group("ranked")) != expected_ranked:
            raise ValueError(f"weighted Score ranking mismatch for {event_identity}")
        if parse_symbols(trace.group("selected")) != expected_selected:
            raise ValueError(f"weighted Score Selection mismatch for {event_identity}")
        target = targets[event_identity]
        if target.selected != tuple(sorted(expected_selected)):
            raise ValueError(f"score-proportional target membership mismatch for {event_identity}")
        if not division_derived_scores_match(target.weights, reference.target_weights):
            raise ValueError(f"score-proportional target weight mismatch for {event_identity}")

    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("weighted Score backtest submitted no orders")
    return len(traces), normalized.total_orders
