from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.codegen import CSharpGenerationSettings
from ruletrade.compiler.lean.e2e import (
    DIVISION_DERIVED_SCORE_TOLERANCE,
    load_aligned_daily_closes,
    parse_target_records,
    validate_lean_completion,
    validate_zero_failed_data_requests,
)
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.execution_profiles import (
    ExecutionClosureProfile,
    production_execution_profile,
)
from ruletrade.strategy.v2.program_execution import execute_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


@dataclass(frozen=True)
class StaticProgramDifferentialResult:
    profile: ExecutionClosureProfile
    decisions: int
    orders: int


def _weights_match(actual: dict[str, Decimal], expected: dict[str, Decimal]) -> bool:
    return actual.keys() == expected.keys() and all(
        abs(actual[symbol] - expected[symbol]) <= DIVISION_DERIVED_SCORE_TOLERANCE
        for symbol in expected
    )


def verify_static_program_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
    *,
    profile: ExecutionClosureProfile,
) -> StaticProgramDifferentialResult:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)
    targets = parse_target_records(log_text)
    strategy = production_execution_profile(profile)
    assert strategy.program is not None
    reference_program = strategy.program.model_copy(update={
        "clocks": tuple(clock.model_copy(update={
            "terminal_boundary_policy": "fixture_end_is_boundary",
        }) for clock in strategy.program.clocks),
    })
    symbols = tuple(sorted({
        symbol
        for asset_set in strategy.definitions.asset_sets
        for symbol in asset_set.assets
    } | {
        item.selection.fallback_asset
        for item in strategy.program.statements
        if item.kind == "select" and item.selection.fallback_asset is not None
    } | ({"TLT"} if profile == "conditional" else set())))
    dates, closes = load_aligned_daily_closes(
        fixture, symbols, fixture_name=f"Static Program {profile}",
    )
    settings = CSharpGenerationSettings()
    retained_indices = [
        index for index, compact_date in enumerate(dates)
        if settings.start_date.isoformat().replace("-", "") <= compact_date
        <= settings.end_date.isoformat().replace("-", "")
    ]
    dates = [dates[index] for index in retained_indices]
    closes = {
        symbol: [values[index] for index in retained_indices]
        for symbol, values in closes.items()
    }
    target_by_date = {
        target.event_identity.replace("-", ""): target
        for target in targets
        if target.event_identity.replace("-", "") in dates
    }
    domains = {
        group.id: tuple(next(
            item.assets for item in strategy.definitions.asset_sets
            if item.id == group.asset_set_ref
        ))
        for group in strategy.definitions.groups
    }
    snapshot = DailyMarketSnapshot(
        snapshot_id=f"static-program-{profile}@1",
        clock=Clock(id="daily-close"),
        dates=tuple(f"{item[:4]}-{item[4:6]}-{item[6:8]}" for item in dates),
        domains=domains,
        series={symbol: {"close:adjusted": tuple(values)} for symbol, values in closes.items()},
    )
    expected_decisions = 0
    date_indices = {compact_date: index for index, compact_date in enumerate(dates)}
    for compact_date, target in sorted(target_by_date.items()):
        index = date_indices[compact_date]
        reference = execute_program_v2(reference_program, snapshot, cutoff_index=index)
        if not reference.target_weights:
            raise ValueError(f"{profile} produced no reference target for {compact_date}")
        expected_decisions += 1
        if not _weights_match(target.weights, reference.target_weights):
            raise ValueError(
                f"{profile} target mismatch at {target.event_identity}: "
                f"LEAN={target.weights} reference={reference.target_weights}"
            )
    if expected_decisions != 12 or len(target_by_date) != expected_decisions:
        raise ValueError(
            f"{profile} must match 12 in-fixture monthly decisions: "
            f"reference={expected_decisions} LEAN={len(target_by_date)} raw={len(targets)}"
        )
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError(f"{profile} submitted no actual orders")
    return StaticProgramDifferentialResult(
        profile=profile, decisions=expected_decisions, orders=normalized.total_orders,
    )
