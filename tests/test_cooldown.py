from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import replace
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.compiler.lean.cooldown_e2e import load_cooldown_fixture, verify_cooldown_e2e
from ruletrade.ir.strategy import (
    DailyScheduleOp,
    ElapsedSessionsGateOp,
    IRValidationError,
    ObserveTargetExitsOp,
    validate_strategy_ir,
)
from ruletrade.strategy.v1.cooldown import evaluate_cooldown
from ruletrade.strategy.v1.fixtures import COOLDOWN_PAYLOAD, cooldown_strategy, golden_portfolio_strategy
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.validation import StrategySemanticError, validate_strategy_v1

FIXTURE = Path(__file__).parent / "fixtures" / "lean-cooldown-data"


def _fixture_reference():
    dates, closes = load_cooldown_fixture(FIXTURE)
    events: list[str] = []
    candidates: dict[str, tuple[str, ...]] = {}
    scores_by_event: dict[str, dict[str, Decimal]] = {}
    for index, compact in enumerate(dates):
        current = date.fromisoformat(f"{compact[:4]}-{compact[4:6]}-{compact[6:]}")
        if not date(2024, 1, 2) <= current <= date(2024, 2, 29):
            continue
        event = current.isoformat()
        scores = {
            symbol: values[index] / values[index - 1] - Decimal(1)
            for symbol, values in closes.items()
        }
        events.append(event)
        scores_by_event[event] = scores
        candidates[event] = (min(scores, key=lambda item: (-scores[item], item)),)
    return evaluate_cooldown(events, candidates), scores_by_event


def test_source_preserves_high_level_cooldown_intent() -> None:
    strategy = cooldown_strategy()
    validate_strategy_v1(strategy)
    component = next(item for item in strategy.graph.components if item.id == "cooldown")
    assert component.primitive == "cooldown@1"
    assert component.config == {"duration": 20, "unit": "trading_days"}
    assert not strategy.definitions.state


def test_source_rejects_invalid_cooldown_atomically_at_validation_boundary() -> None:
    payload = json.loads(json.dumps(COOLDOWN_PAYLOAD))
    next(item for item in payload["graph"]["components"] if item["id"] == "cooldown")[
        "config"
    ]["duration"] = 0
    strategy = CanonicalStrategyV1.model_validate(payload)
    with pytest.raises(StrategySemanticError, match="must be at least 1"):
        validate_strategy_v1(strategy)


def test_cooldown_desugars_to_state_gate_and_exit_observer_not_retained_targets() -> None:
    strategy_ir = lower_strategy_model_to_ir(cooldown_strategy())
    operations = {item.id: item for item in strategy_ir.operations}
    assert isinstance(operations["daily"], DailyScheduleOp)
    assert isinstance(operations["cooldown"], ElapsedSessionsGateOp)
    assert isinstance(operations["cooldown$observe_exits"], ObserveTargetExitsOp)
    assert operations["rebalance"].targets == "cooldown$observe_exits"
    assert strategy_ir.user_state[0].id == "cooldown$last_exit"
    assert "RetainTargetsOp" not in {type(item).__name__ for item in strategy_ir.operations}


def test_ir_rejects_missing_user_state_declaration() -> None:
    strategy_ir = lower_strategy_model_to_ir(cooldown_strategy())
    with pytest.raises(IRValidationError, match="unknown user state"):
        validate_strategy_ir(replace(strategy_ir, user_state=()))


def test_requirements_separate_state_calendar_history_and_schedule() -> None:
    requirements = analyze_strategy_ir(lower_strategy_model_to_ir(cooldown_strategy()))
    assert requirements.assets == ("IEF", "QQQ")
    assert [(item.operation, item.day) for item in requirements.schedules] == [
        ("schedule.daily", None)
    ]
    assert requirements.daily_history[0].symbols == ("QQQ", "IEF")
    assert requirements.daily_history[0].observation_count == 2
    assert requirements.user_state[0].mutation == "target_exit"
    assert requirements.trading_calendars[0].symbols == ("QQQ", "IEF")


def test_lean_plan_keeps_cooldown_state_distinct_from_target_snapshots() -> None:
    plan = compile_strategy_to_lean_plan(cooldown_strategy())
    assert len(plan.daily_events) == 1
    assert plan.target_snapshots == ()
    assert plan.cooldown_states[0].required_completed_sessions == 20
    assert plan.cooldown_states[0].calendar_symbol == "QQQ"
    assert plan.momentum_selections[0].selection_component_id == "top_n"
    assert plan.momentum_selections[0].id == "cooldown"
    assert plan.rebalances[0].exit_state_ids == ("cooldown$last_exit",)


def test_oracle_exit_day_zero_weekend_holiday_and_day_20_boundary() -> None:
    events, _ = _fixture_reference()
    by_date = {item.event: item for item in events}
    assert by_date["2024-01-02"].selected == ("QQQ",)
    assert by_date["2024-01-03"].exits == ("QQQ",)
    assert by_date["2024-01-04"].eligibility[0].elapsed_trading_days == 1
    assert "2024-01-15" not in by_date  # Martin Luther King Jr. Day
    assert by_date["2024-01-16"].eligibility[0].elapsed_trading_days == 8
    assert by_date["2024-01-31"].eligibility[0].elapsed_trading_days == 19
    assert by_date["2024-01-31"].selected == ()
    assert by_date["2024-02-01"].eligibility[0].elapsed_trading_days == 20
    assert by_date["2024-02-01"].selected == ("QQQ",)


def test_codegen_uses_exchange_sessions_and_target_transition_state() -> None:
    source = generate_csharp(
        compile_strategy_to_lean_plan(cooldown_strategy()),
        CSharpGenerationSettings(end_date=date(2024, 2, 29)),
    )
    assert "DateRules.EveryDay" in source
    assert ".Exchange.Hours.IsDateOpen(Time.Date, false)" in source
    assert "elapsed >= 20" in source
    assert "RULETRADE_COOLDOWN|" in source
    assert "RULETRADE_STATE|" in source
    assert 'EmitDecisionEvidence(eventIdentity, "selection", "cooldown"' in source
    assert 'EmitDecisionEvidence(eventIdentity, "state_mutation", "state_mutation"' in source
    assert source.index("RULETRADE_STATE|") < source.index("Liquidate(holding.Symbol)")
    assert "_targetSnapshot" not in source
    assert "RULETRADE_COOLDOWN|" not in generate_csharp(
        compile_strategy_to_lean_plan(golden_portfolio_strategy())
    )


def test_cooldown_fixture_is_reproducible_and_uses_exchange_sessions(tmp_path: Path) -> None:
    generated = tmp_path / "lean-cooldown-data"
    subprocess.run(
        [
            sys.executable,
            "scripts/generate_golden_lean_fixture.py",
            "--profile",
            "cooldown",
            "--output",
            str(generated),
        ],
        check=True,
    )
    tracked_files = sorted(path.relative_to(FIXTURE) for path in FIXTURE.rglob("*") if path.is_file())
    generated_files = sorted(
        path.relative_to(generated) for path in generated.rglob("*") if path.is_file()
    )
    assert generated_files == tracked_files
    for relative in tracked_files:
        assert (generated / relative).read_bytes() == (FIXTURE / relative).read_bytes()
    dates, _ = load_cooldown_fixture(FIXTURE)
    assert "20240113" not in dates  # Saturday
    assert "20240115" not in dates  # US exchange holiday


def test_strict_cooldown_verifier_compares_state_and_boundary() -> None:
    reference, scores_by_event = _fixture_reference()
    lines = ["Algorithm Id: test completed", "Failed data requests 0"]
    for item in reference:
        scores = scores_by_event[item.event]
        ranked = sorted(scores, key=lambda symbol: (-scores[symbol], symbol))
        lines.append(
            f"RULETRADE_SIGNAL|{item.event}|scores="
            + ",".join(f"{symbol}={scores[symbol]}" for symbol in sorted(scores))
            + f"|ranked={','.join(ranked)}|candidate={','.join(item.candidates)}"
        )
        decision = item.eligibility[0]
        lines.append(
            f"RULETRADE_COOLDOWN|{item.event}|component=cooldown|asset={decision.asset}"
            f"|candidate=true|last_exit={decision.last_exit or 'none'}"
            f"|elapsed_trading_days="
            f"{'none' if decision.elapsed_trading_days is None else decision.elapsed_trading_days}"
            f"|required=20|decision={decision.decision}"
        )
        for asset in item.exits:
            lines.append(
                f"RULETRADE_STATE|{item.event}|component=cooldown|asset={asset}"
                f"|state=last_exit|old=none|new={item.event}|cause=target_exit"
            )
        weights = ",".join(f"{symbol}={weight}" for symbol, weight in item.targets)
        lines.append(
            f"RULETRADE_TARGETS|{item.event}|selected={','.join(item.selected)}|weights={weights}"
        )
    result_payload = json.loads(
        (Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json")
        .read_text()
    )
    assert verify_cooldown_e2e("\n".join(lines), result_payload, FIXTURE)[::2] == (
        41,
        "2024-02-01",
    )
