from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import (
    division_derived_scores_match,
    load_aligned_daily_closes,
    parse_decimal_map,
    parse_target_records,
    validate_lean_completion,
)
from ruletrade.strategy.v1.momentum import evaluate_trailing_return_top_n

MOMENTUM_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|scores=(?P<scores>[A-Z0-9.,_=:+-]+)"
    r"\|ranked=(?P<ranked>[A-Z0-9,]+)"
    r"\|selected=(?P<selected>[A-Z0-9,]+)"
)
SYMBOLS = ("QQQ", "VGT", "SOXX", "SCHG")


def _fixture_closes(fixture: Path) -> tuple[list[str], dict[str, list[Decimal]]]:
    return load_aligned_daily_closes(fixture, SYMBOLS, fixture_name="Momentum")


def verify_momentum_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int]:
    validate_lean_completion(log_text)
    traces = {match.group("event"): match for match in MOMENTUM_PATTERN.finditer(log_text)}
    targets = parse_target_records(log_text)
    if len(traces) != 12 or len(targets) != 12:
        raise ValueError(
            f"expected 12 Momentum events, got traces={len(traces)}, targets={len(targets)}"
        )
    dates, closes = _fixture_closes(fixture)
    for target in targets:
        compact_date = target.event_identity.replace("-", "")
        index = dates.index(compact_date)
        reference = evaluate_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            count=2,
        )
        trace = traces[target.event_identity]
        if tuple(trace.group("ranked").split(",")) != reference.ranked:
            raise ValueError(f"ranking mismatch for {target.event_identity}")
        if tuple(trace.group("selected").split(",")) != reference.selected:
            raise ValueError(f"selection mismatch for {target.event_identity}")
        if target.selected != tuple(sorted(reference.selected)):
            raise ValueError(f"target selection mismatch for {target.event_identity}")
        if target.weights != dict(reference.targets):
            raise ValueError(f"target weights mismatch for {target.event_identity}")
        actual_scores = parse_decimal_map(trace.group("scores"))
        if not division_derived_scores_match(actual_scores, dict(reference.scores)):
            raise ValueError(f"score mismatch for {target.event_identity}")
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("Momentum backtest submitted no orders")
    return len(targets), normalized.total_orders
