from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal
import json
from pathlib import Path

import pytest

from ruletrade.compiler.lean.checkpoint import (
    TemporalCheckpointError, deserialize_checkpoint, seal_checkpoint,
    serialize_checkpoint, validate_checkpoint,
)
from ruletrade.compiler.lean.codegen import CSharpGenerationSettings, generate_csharp
from ruletrade.compiler.lean.plan import LeanTemporalCheckpoint
from ruletrade.strategy.v2.bridge import V2LoweringError, compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import (
    temporal_breakout_program, temporal_breakout_strategy,
    temporal_multiclock_program, temporal_multiclock_strategy,
)
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


def _checkpoint() -> tuple[LeanTemporalCheckpoint, object]:
    plan = compile_v2_strategy_to_lean_plan(temporal_breakout_strategy())
    assert plan.temporal_program is not None
    checkpoint = seal_checkpoint(LeanTemporalCheckpoint(
        schema_version="ruletrade-temporal-checkpoint@1",
        profile="event-state-daily@1",
        strategy_identity=plan.strategy_identity,
        checkpoint_identity=plan.temporal_program.checkpoint_identity,
        snapshot_id="lean-temporal-data@1",
        clock_id="daily-close",
        cutoff="2024-01-04",
        boundary_index=2,
        operator_versions=plan.temporal_program.operator_versions,
        asset_universe=("QQQ",),
        statement_order=(
            *(item.statement_id for item in plan.temporal_program.events),
            plan.temporal_program.policy_statement_id,
        ),
        state=(("phase", "broken"),),
        state_entered_cutoffs=(("phase", 2),),
        event_cutoffs=(("breakout-event", 2),),
        event_truths=(("breakout-event", "true"), ("confirmation-event", "false"),
                      ("expiry-event", "false"), ("retest-event", "false")),
        event_counts=(("breakout-event", 1),),
        memory=(("breakout-level", Decimal("13")),),
        memory_capture_cutoffs=(("breakout-level", 2),),
        memory_value_ids=(("breakout-level", "temporal-price"),),
        last_policy_target="cash|",
        active_week_key="2024-W01",
        active_week_close=Decimal("13"),
        active_week_cutoff="2024-01-04",
        portfolio_target="cash|",
    ))
    return checkpoint, plan


def test_checkpoint_round_trip_validation_and_codegen_restore_are_explicit() -> None:
    checkpoint, plan = _checkpoint()
    restored = deserialize_checkpoint(serialize_checkpoint(checkpoint))
    assert plan.temporal_program is not None
    validate_checkpoint(
        restored, plan.temporal_program,
        strategy_identity=plan.strategy_identity,
        snapshot_id="lean-temporal-data@1",
        resume_start=date(2024, 1, 5),
    )
    source = generate_csharp(plan, CSharpGenerationSettings(
        start_date=date(2024, 1, 5), snapshot_id="lean-temporal-data@1",
        temporal_checkpoint=restored,
    ))
    assert '"checkpoint_import", "checkpoint_import"' in source
    assert "_boundaryIndex = 2" in source
    assert '_memory["breakout-level"] = 13m' in source


@pytest.mark.parametrize(
    ("mutation", "message"),
    (
        ({"schema_version": "ruletrade-temporal-checkpoint@2"}, "schema_incompatible"),
        ({"checkpoint_identity": "wrong"}, "semantic_hash_mismatch"),
        ({"snapshot_id": "wrong"}, "snapshot_mismatch"),
        ({"operator_versions": (("compare", "999"),)}, "operator_version_mismatch"),
        ({"asset_universe": ("SPY",)}, "asset_universe_mismatch"),
        ({"statement_order": ("wrong",)}, "statement_order_mismatch"),
        ({"cutoff": "2024-01-08"}, "not_before_resume_start"),
        ({"memory": (), "memory_capture_cutoffs": (), "memory_value_ids": ()}, "required_memory_missing"),
    ),
)
def test_checkpoint_counterexamples_are_rejected(mutation: dict[str, object], message: str) -> None:
    checkpoint, plan = _checkpoint()
    corrupted = seal_checkpoint(replace(checkpoint, **mutation, integrity_hash=""))
    assert plan.temporal_program is not None
    with pytest.raises(TemporalCheckpointError, match=message):
        validate_checkpoint(
            corrupted, plan.temporal_program,
            strategy_identity=plan.strategy_identity,
            snapshot_id="lean-temporal-data@1",
            resume_start=date(2024, 1, 5),
        )


def test_checkpoint_integrity_corruption_is_rejected() -> None:
    checkpoint, _plan = _checkpoint()
    payload = serialize_checkpoint(checkpoint).replace('"boundary_index":2', '"boundary_index":99')
    with pytest.raises(TemporalCheckpointError, match="integrity_mismatch"):
        deserialize_checkpoint(payload)


def test_equivalent_checkpoint_map_order_serializes_identically() -> None:
    checkpoint, _plan = _checkpoint()
    reordered = replace(
        checkpoint,
        event_truths=tuple(reversed(checkpoint.event_truths)),
        integrity_hash="",
    )
    assert serialize_checkpoint(reordered) == serialize_checkpoint(checkpoint)


def test_multiclock_profile_is_lowered_without_future_weekly_data() -> None:
    plan = compile_v2_strategy_to_lean_plan(temporal_multiclock_strategy())
    assert plan.temporal_program is not None
    assert plan.temporal_program.profile == "event-state-multiclock@1"
    assert plan.temporal_program.events[0].condition.left.kind == "completed_weekly_price"
    source = generate_csharp(plan, CSharpGenerationSettings(snapshot_id="lean-multiclock-data@1"))
    assert "weekly_completion" in source
    assert "ISOWeek.GetWeekOfYear" in source

    snapshot = DailyMarketSnapshot(
        snapshot_id="weekly-daily", clock=Clock(id="daily-close"),
        dates=("2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
               "2024-01-08", "2024-01-09", "2024-01-10"),
        domains={"temporal-group": ("QQQ",)},
        series={"QQQ": {"close:adjusted": tuple(map(Decimal, ("10", "11", "13", "14", "13", "12", "15")))}},
    )
    program = temporal_multiclock_program()
    prior = None
    results = []
    for cutoff in range(len(snapshot.dates)):
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
    assert all(item.state["phase"] == "idle" for item in results[:4])
    assert [item.state["phase"] for item in results[4:]] == ["broken", "retested", "confirmed"]
    monday_weekly = next(
        item for item in results[4].value_observations
        if item.semantic_id == "completed-weekly-close"
    )
    assert monday_weekly.value == Decimal("14")
    assert monday_weekly.observed_at == "2024-01-05"


def test_holiday_short_week_and_missing_weekly_context_are_honest() -> None:
    program = temporal_multiclock_program()
    missing = temporal_snapshot(("10", "11", "13", "14"))
    first = execute_program_v2(program, missing, cutoff_index=3)
    weekly = next(item for item in first.value_observations if item.semantic_id == "completed-weekly-close")
    assert weekly.value is None
    assert weekly.reason == "completed_clock_observation_unavailable"

    shortened = DailyMarketSnapshot(
        snapshot_id="holiday-short-week", clock=Clock(id="daily-close"),
        dates=("2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19", "2024-01-22"),
        domains={"temporal-group": ("QQQ",)},
        series={"QQQ": {"close:adjusted": tuple(map(Decimal, ("10", "11", "13", "14", "15")))}},
    )
    monday = execute_program_v2(program, shortened, cutoff_index=4)
    observed = next(item for item in monday.value_observations if item.semantic_id == "completed-weekly-close")
    assert observed.observed_at == "2024-01-19"
    assert observed.value == Decimal("14")


def test_temporal_capability_ledger_keeps_evidence_dimensions_independent() -> None:
    payload = json.loads(
        (Path(__file__).parents[1] / "corpus" / "temporal-reliability-capability-matrix.json")
        .read_text(encoding="utf-8")
    )
    profiles = {item["profile"]: item for item in payload["profiles"]}
    daily = profiles["event-state-daily@1"]
    assert daily["docker_verified"] == "PASS"
    assert daily["restart_replay_verified"] == "PASS"
    assert daily["ui_authorable"] == "UNSUPPORTED"
    weekly = profiles["event-state-multiclock@1"]
    assert weekly["docker_verified"] == "PASS"
    assert weekly["restart_replay_verified"] == "NOT_PROVEN"
    general = profiles["general-event-state-multiclock"]
    assert general["backend_lowerable"] == "UNSUPPORTED"
    assert general["docker_verified"] == "NOT_PROVEN"
