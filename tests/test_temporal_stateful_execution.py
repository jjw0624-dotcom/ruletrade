from __future__ import annotations

from decimal import Decimal

import pytest

from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.strategy.v2.bridge import V2LoweringError, compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import temporal_breakout_program, temporal_breakout_strategy
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.program_execution import ProgramExecutionResult, execute_program_v2
from ruletrade.strategy.v2.projections import inspector_addresses, projection_bundle
from ruletrade.strategy.v2.semantic_types import Clock


def temporal_snapshot(values: tuple[str, ...]) -> DailyMarketSnapshot:
    dates = tuple(f"2024-01-{index + 2:02d}" for index in range(len(values)))
    return DailyMarketSnapshot(
        snapshot_id="temporal-stateful-test", clock=Clock(id="daily-close"),
        dates=dates, domains={"temporal-group": ("QQQ",)},
        series={"QQQ": {"close:adjusted": tuple(map(Decimal, values))}},
    )


def run_boundaries(snapshot: DailyMarketSnapshot, *, checkpoint: ProgramExecutionResult | None = None, start: int = 0) -> tuple[ProgramExecutionResult, ...]:
    program = temporal_breakout_program()
    prior = checkpoint
    results = []
    for cutoff in range(start, len(snapshot.dates)):
        result = execute_program_v2(
            program, snapshot, cutoff_index=cutoff,
            prior_state=None if prior is None else prior.state,
            event_cutoffs=None if prior is None else prior.event_cutoffs,
            prior_event_truths=None if prior is None else prior.event_truths,
            event_counts=None if prior is None else prior.event_counts,
            state_entered_cutoffs=None if prior is None else prior.state_entered_cutoffs,
            remembered_values=None if prior is None else prior.remembered_values,
        )
        results.append(result)
        prior = result
    return tuple(results)


def test_breakout_retest_confirmation_memory_policy_and_replay_are_deterministic() -> None:
    snapshot = temporal_snapshot(("10", "11", "13", "12", "14", "14"))
    first = run_boundaries(snapshot)
    second = run_boundaries(snapshot)
    assert [item.state["phase"] for item in first] == [
        "idle", "idle", "broken", "retested", "confirmed", "confirmed",
    ]
    assert first == second
    assert first[2].remembered_values == {"breakout-level": Decimal("13")}
    assert first[4].target_weights == {"QQQ": Decimal(1)}

    resumed = run_boundaries(snapshot, checkpoint=first[2], start=3)
    assert resumed == first[3:]


def test_expiry_equal_threshold_retest_before_breakout_and_future_data_are_safe() -> None:
    expired = run_boundaries(temporal_snapshot(("10", "12", "13", "12", "12", "12", "14")))
    assert expired[1].state["phase"] == "idle"  # equal to breakout threshold is not a crossing
    assert expired[-1].state["phase"] == "expired"
    assert expired[-1].target_weights == {"CASH": Decimal(1)}
    assert "retest-event" not in expired[1].event_cutoffs

    base = temporal_snapshot(("10", "11", "13", "12", "14"))
    extended = temporal_snapshot(("10", "11", "13", "12", "14", "999"))
    assert run_boundaries(base) == run_boundaries(extended)[:5]


def test_temporal_profile_extends_typed_plan_and_emits_structured_observations() -> None:
    plan = compile_v2_strategy_to_lean_plan(temporal_breakout_strategy())
    assert plan.temporal_program is not None
    assert plan.temporal_program.profile == "event-state-daily@1"
    assert [item.semantic_id for item in plan.temporal_program.events] == [
        "breakout-event", "retest-event", "confirmation-event", "expiry-event",
    ]
    source = generate_csharp(plan)
    for marker in (
        '"event_detection", "event"', '"state_transition", "transition"',
        '"memory_capture", "remember"', '"policy", "policy_decision"',
        '"checkpoint", "checkpoint"', "public override void OnOrderEvent",
    ):
        assert marker in source
    assert source.index('"breakout-event"') < source.index('"retest-event"') < source.index('"confirmation-event"')
    assert "ExecuteTemporalBoundary" in source


def test_temporal_lowerer_rejects_unproven_weekly_backend_profile() -> None:
    strategy = temporal_breakout_strategy()
    program = strategy.program
    assert program is not None
    weekly = program.clocks[0].model_copy(update={"timeframe": "weekly"})
    unsupported = strategy.model_copy(update={"program": program.model_copy(update={"clocks": (weekly,)})})
    with pytest.raises(V2LoweringError, match="completed daily close"):
        compile_v2_strategy_to_lean_plan(unsupported)


def test_temporal_projection_contracts_remain_ui_independent_and_addressable() -> None:
    strategy = temporal_breakout_strategy()
    bundle = projection_bundle(strategy)
    assert set(bundle) == {"structure", "flow", "blocky", "rules", "summary"}
    assert all(item.semantic_valid for item in bundle.values())
    blocky_ids = [item.address.semantic_id for item in bundle["blocky"].items]
    assert "breakout-event-statement" in blocky_ids
    addresses = inspector_addresses(strategy)
    assert any(intent.address.semantic_id == "remember-breakout" for intent in addresses.intents)
