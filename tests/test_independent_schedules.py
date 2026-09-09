from __future__ import annotations

import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean import generate_csharp
from ruletrade.compiler.lean.filter_e2e import load_filter_fixture_closes
from ruletrade.compiler.lean.independent_schedules_e2e import (
    verify_independent_schedules_e2e,
)
from ruletrade.ir.strategy import (
    IRValidationError,
    QuarterlyScheduleOp,
    RetainTargetsOp,
    validate_strategy_ir,
)
from ruletrade.strategy.v1.fixtures import independent_schedules_strategy
from ruletrade.strategy.v1.temporal import evaluate_independent_schedules
from ruletrade.strategy.v1.validation import validate_strategy_v1

EVENTS = (
    "2024-01-02", "2024-02-01", "2024-03-01", "2024-04-01",
    "2024-05-01", "2024-06-03", "2024-07-01", "2024-08-01",
    "2024-09-03", "2024-10-01", "2024-11-01", "2024-12-02",
)


def _fixture_closes():
    dates, closes = load_filter_fixture_closes(
        Path(__file__).parent / "fixtures" / "lean-filter-data"
    )
    return {
        event: {
            symbol: values[: dates.index(event.replace("-", "")) + 1]
            for symbol, values in closes.items()
        }
        for event in EVENTS
    }


def test_source_expresses_refresh_and_execution_as_distinct_entrypoints() -> None:
    strategy = independent_schedules_strategy()
    validate_strategy_v1(strategy)
    assert {
        (item.event_component_id, item.target_component_id)
        for item in strategy.entrypoints
    } == {
        ("growth_monthly", "growth_sleeve"),
        ("portfolio_quarterly", "defensive_sleeve"),
        ("portfolio_quarterly", "rebalance"),
    }


def test_desugaring_retains_latest_local_targets_without_user_state() -> None:
    strategy_ir = lower_strategy_model_to_ir(independent_schedules_strategy())
    operations = {item.id: item for item in strategy_ir.operations}
    assert isinstance(operations["portfolio_quarterly"], QuarterlyScheduleOp)
    assert isinstance(operations["growth_sleeve"], RetainTargetsOp)
    assert isinstance(operations["defensive_sleeve"], RetainTargetsOp)
    assert operations["growth_sleeve$scaled"].targets == "growth_sleeve"
    assert not independent_schedules_strategy().definitions.state


def test_ir_rejects_unscheduled_retained_targets() -> None:
    strategy_ir = lower_strategy_model_to_ir(independent_schedules_strategy())
    entrypoints = tuple(
        item for item in strategy_ir.entrypoints if item.target != "growth_sleeve"
    )
    with pytest.raises(IRValidationError, match="scheduled refresh entrypoint"):
        validate_strategy_ir(replace(strategy_ir, entrypoints=entrypoints))


def test_requirements_keep_schedules_and_history_scope_explicit() -> None:
    requirements = analyze_strategy_ir(
        lower_strategy_model_to_ir(independent_schedules_strategy())
    )
    assert requirements.assets == ("IEF", "QQQ", "SCHG", "SOXX", "TLT", "VGT")
    assert [(item.source_component_id, item.operation) for item in requirements.schedules] == [
        ("growth_monthly", "schedule.monthly"),
        ("portfolio_quarterly", "schedule.quarterly"),
    ]
    assert requirements.daily_history[0].symbols == ("QQQ", "VGT", "SOXX", "SCHG")


def test_lean_plan_separates_refreshes_from_quarterly_execution() -> None:
    plan = compile_strategy_to_lean_plan(independent_schedules_strategy())
    assert [item.id for item in plan.target_snapshots] == [
        "defensive_sleeve",
        "growth_sleeve",
    ]
    assert plan.monthly_events[0].refresh_ids == ("growth_sleeve",)
    assert plan.monthly_events[0].rebalance_ids == ()
    assert plan.quarterly_events[0].refresh_ids == ("defensive_sleeve",)
    assert plan.quarterly_events[0].rebalance_ids == ("rebalance",)
    assert len(plan.rebalances[0].snapshot_allocations) == 2


def test_temporal_oracle_refreshes_before_same_day_execution_and_reuses_latest() -> None:
    result = evaluate_independent_schedules(EVENTS, _fixture_closes())
    assert len(result.refreshes) == 16
    assert len(result.portfolio_events) == 4
    january = result.portfolio_events[0]
    april = result.portfolio_events[1]
    assert january.snapshot_timestamps == (
        ("defensive_sleeve", "2024-01-02"),
        ("growth_sleeve", "2024-01-02"),
    )
    assert april.snapshot_timestamps == (
        ("defensive_sleeve", "2024-04-01"),
        ("growth_sleeve", "2024-04-01"),
    )
    assert sum((weight for _, weight in april.final_targets), Decimal(0)) == Decimal(1)


def test_temporal_oracle_skips_until_every_snapshot_exists() -> None:
    result = evaluate_independent_schedules(
        EVENTS,
        _fixture_closes(),
        defensive_refresh_months=frozenset({4, 7, 10}),
    )
    assert result.portfolio_events[0].decision == "skipped"
    assert result.portfolio_events[0].final_targets == ()
    assert result.portfolio_events[1].decision == "executed"


def test_codegen_has_global_refresh_then_execution_phases_and_snapshot_traces() -> None:
    source = generate_csharp(compile_strategy_to_lean_plan(independent_schedules_strategy()))
    growth_refresh_call = source.index("RefreshEvent0(readyEvent0)")
    defensive_refresh_call = source.index("RefreshEvent1(readyEvent1)")
    execution_call = source.index("ExecuteEvent1(readyEvent1)")
    assert growth_refresh_call < execution_call
    assert defensive_refresh_call < execution_call
    assert "RULETRADE_REFRESH|" in source
    assert "RULETRADE_PORTFOLIO_EVENT|" in source
    assert "if ((Time.Month - 1) % 3 != 0) return;" in source
    assert "_targetSnapshotTimestamp" in source


def test_strict_temporal_verifier_compares_refresh_provenance_and_targets() -> None:
    fixture = Path(__file__).parent / "fixtures" / "lean-filter-data"
    reference = evaluate_independent_schedules(EVENTS, _fixture_closes())
    lines = ["Algorithm Id: test completed", "Failed data requests 0"]
    for snapshot in reference.refreshes:
        if snapshot.growth_decision is not None:
            growth = snapshot.growth_decision
            scores = ",".join(f"{symbol}={value}" for symbol, value in growth.scores)
            lines.extend(
                (
                    f"RULETRADE_FILTER|{snapshot.refreshed_at}|threshold=0"
                    f"|eligible={','.join(growth.eligible)}|rejected={','.join(growth.rejected)}",
                    f"RULETRADE_MOMENTUM|{snapshot.refreshed_at}|scores={scores}"
                    f"|ranked={','.join(growth.ranked)}|candidate={','.join(growth.candidate)}"
                    f"|selected={','.join(growth.primary_selected)}"
                    f"|decision={'insufficient' if growth.fallback_activated else 'executed'}",
                    f"RULETRADE_FALLBACK|{snapshot.refreshed_at}|component=fallback|asset=TLT"
                    f"|decision={'activated' if growth.fallback_activated else 'not_activated'}",
                    f"RULETRADE_FINAL|{snapshot.refreshed_at}|selected={','.join(growth.final_selected)}"
                    f"|decision=executed|source={'fallback' if growth.fallback_activated else 'primary'}",
                )
            )
        targets = ",".join(f"{symbol}={weight}" for symbol, weight in snapshot.local_targets)
        schedule = "monthly" if snapshot.sleeve_id == "growth_sleeve" else "quarterly"
        lines.append(
            f"RULETRADE_REFRESH|{snapshot.refreshed_at}|sleeve={snapshot.sleeve_id}"
            f"|schedule={schedule}|local_targets={targets}|snapshot={snapshot.refreshed_at}"
        )
    for decision in reference.portfolio_events:
        timestamps = ",".join(
            f"{sleeve}={timestamp}" for sleeve, timestamp in decision.snapshot_timestamps
        )
        lines.append(
            f"RULETRADE_PORTFOLIO_EVENT|{decision.event}|schedule=quarterly"
            f"|snapshots={timestamps}|decision={decision.decision}"
        )
        for sleeve_id, scaled in decision.scaled_contributions:
            snapshot = next(
                item
                for item in reversed(reference.refreshes)
                if item.sleeve_id == sleeve_id and item.refreshed_at <= decision.event
            )
            local = ",".join(f"{symbol}={weight}" for symbol, weight in snapshot.local_targets)
            scaled_text = ",".join(f"{symbol}={weight}" for symbol, weight in scaled)
            allocation = "0.70" if sleeve_id == "growth_sleeve" else "0.30"
            lines.append(
                f"RULETRADE_SLEEVE|{decision.event}|sleeve={sleeve_id}"
                f"|local_selected={','.join(symbol for symbol, _ in snapshot.local_targets)}"
                f"|local_weights={local}|allocation={allocation}|scaled={scaled_text}"
            )
        final = ",".join(f"{symbol}={weight}" for symbol, weight in decision.final_targets)
        lines.append(
            f"RULETRADE_TARGETS|{decision.event}"
            f"|selected={','.join(symbol for symbol, _ in decision.final_targets)}|weights={final}"
        )
    result_payload = json.loads(
        (Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json")
        .read_text()
    )
    assert verify_independent_schedules_e2e(
        "\n".join(lines), result_payload, fixture
    )[:3] == (16, 4, 7)
