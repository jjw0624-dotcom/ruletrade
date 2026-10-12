from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import (
    division_derived_scores_match, load_aligned_daily_closes, parse_decimal_map,
    validate_lean_completion, validate_zero_failed_data_requests,
)
from ruletrade.compiler.lean.filter_e2e import SYMBOLS, load_filter_fixture_closes
from ruletrade.compiler.lean.temporal_e2e import parse_temporal_evidence
from ruletrade.strategy.v2.corpus import (
    composable_semantic_execution_strategy, composable_split_execution_strategy,
)
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.program_execution import ProgramExecutionResult, execute_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


@dataclass(frozen=True)
class ComposableDifferentialResult:
    boundaries: int
    selections: int
    allocations: int
    checkpoints: int
    orders: int


def verify_composable_e2e(
    log_text: str, result_payload: object, fixture: Path, *, profile: str = "integrated",
) -> ComposableDifferentialResult:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)
    records = parse_temporal_evidence(log_text)
    boundaries = [item for item in records if item.get("kind") == "boundary"]
    selections = [item for item in records if item.get("kind") == "selection"]
    allocations = [item for item in records if item.get("kind") == "allocation"]
    checkpoints = [item for item in records if item.get("kind") == "checkpoint"]
    if not boundaries or not selections or not allocations:
        raise ValueError(
            "composable LEAN path did not exercise its complete pipeline: "
            f"boundaries={len(boundaries)} selections={len(selections)} allocations={len(allocations)}"
        )
    if len(checkpoints) != len(boundaries):
        raise ValueError("every composable boundary must emit a checkpoint")

    fixture_symbols = SYMBOLS if profile == "integrated" else ("QQQ", "VGT", "TLT", "IEF")
    dates, closes = (
        load_filter_fixture_closes(fixture) if profile == "integrated" else
        load_aligned_daily_closes(fixture, fixture_symbols, fixture_name="Composable split")
    )
    snapshot = DailyMarketSnapshot(
        snapshot_id="lean-filter-composable-reference", clock=Clock(id="daily-close"),
        dates=tuple(f"{value[:4]}-{value[4:6]}-{value[6:8]}" for value in dates),
        domains=(
            {"growth": SYMBOLS} if profile == "integrated" else
            {"growth": ("QQQ", "VGT"), "defense": ("TLT", "IEF")}
        ),
        series={symbol: {"close:adjusted": tuple(values)} for symbol, values in closes.items()},
    )
    strategy = (
        composable_semantic_execution_strategy() if profile == "integrated"
        else composable_split_execution_strategy()
    )
    assert strategy.program is not None
    prior: ProgramExecutionResult | None = None
    reference_by_cutoff: dict[str, ProgramExecutionResult] = {}
    start = dates.index("20240102")
    observed_cutoffs = {item["cutoff"] for item in boundaries}
    start_week = date.fromisoformat(snapshot.dates[start]).isocalendar()[:2]
    activation = (
        next(
            index for index in range(start + 1, len(dates))
            if date.fromisoformat(snapshot.dates[index]).isocalendar()[:2] != start_week
        )
        if profile == "integrated" else start
    )
    for cutoff in range(start, len(dates)):
        rendered = snapshot.dates[cutoff]
        if rendered not in observed_cutoffs:
            continue
        # LEAN warm-up imports prices, never a pre-start Event/State or weekly
        # completion checkpoint.  The first completed weekly value becomes
        # available only after this run has observed its own first week.
        if cutoff < activation:
            continue
        prior = execute_program_v2(
            strategy.program, snapshot, cutoff_index=cutoff,
            prior_state=None if prior is None else prior.state,
            event_cutoffs=None if prior is None else prior.event_cutoffs,
            prior_event_truths=None if prior is None else prior.event_truths,
            event_counts=None if prior is None else prior.event_counts,
            state_entered_cutoffs=None if prior is None else prior.state_entered_cutoffs,
            remembered_values=None if prior is None else prior.remembered_values,
        )
        reference_by_cutoff[rendered] = prior

    for record in allocations:
        cutoff = record.get("session", "").removeprefix("daily-close:")
        expected = (
            {"TLT": Decimal(1)}
            if dates.index(cutoff.replace("-", "")) < activation
            else reference_by_cutoff[cutoff].target_weights
        )
        actual = parse_decimal_map(record.get("weights", ""))
        if not division_derived_scores_match(actual, expected):
            raise ValueError(f"composable target differential mismatch at {cutoff}")

    sequence = [int(item["sequence"]) for item in records]
    if sequence != sorted(sequence) or len(sequence) != len(set(sequence)):
        raise ValueError("composable evidence sequence is not total and monotonic")
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("composable backtest submitted no orders")
    return ComposableDifferentialResult(
        len(boundaries), len(selections), len(allocations), len(checkpoints),
        normalized.total_orders,
    )
