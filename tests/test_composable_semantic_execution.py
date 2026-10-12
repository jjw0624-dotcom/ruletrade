from __future__ import annotations

from datetime import date, timedelta
from dataclasses import replace
from decimal import Decimal

from ruletrade.compiler.lean.codegen import CSharpGenerationSettings, generate_csharp
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import (
    composable_semantic_execution_program,
    composable_semantic_execution_strategy,
    composable_split_execution_strategy,
)
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.program_execution import execute_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


def _snapshot() -> DailyMarketSnapshot:
    dates: list[str] = []
    current = date(2023, 9, 1)
    while len(dates) < 100:
        if current.weekday() < 5:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    symbols = ("QQQ", "VGT", "SOXX", "SCHG")
    series = {
        symbol: {
            "close:adjusted": tuple(Decimal(100 + index * (position + 1)) for index in range(100)),
        }
        for position, symbol in enumerate(symbols)
    }
    series["TLT"] = {"close:adjusted": (Decimal(100),) * 100}
    return DailyMarketSnapshot(
        snapshot_id="composable-unit@1", clock=Clock(id="daily-close"),
        dates=tuple(dates), domains={"growth": symbols}, series=series,
    )


def test_typed_plan_composes_temporal_policy_with_weighted_selection() -> None:
    plan = compile_v2_strategy_to_lean_plan(composable_semantic_execution_strategy())
    assert plan.temporal_program is not None
    assert plan.temporal_program.profile == "composable-semantic-execution@1"
    assert plan.temporal_program.execution_order == (
        "data_clocks", "value_readiness", "conditions", "events", "state_memory",
        "policy", "universe", "score_rank", "selection_fallback",
        "allocation_aggregation", "order_intent", "checkpoint_evidence",
    )
    assert plan.momentum_selections[0].ranking_value is not None
    assert plan.momentum_selections[0].ranking_value.kind == "weighted_score"
    assert plan.target_sleeves[0].fallback_symbols == ("TLT",)
    assert set(plan.temporal_program.asset_universe) == {"QQQ", "VGT", "SOXX", "SCHG", "TLT"}


def test_reference_composition_preserves_state_selection_and_score_allocation() -> None:
    result = execute_program_v2(
        composable_semantic_execution_program(), _snapshot(), cutoff_index=64,
    )
    assert result.state == {"regime": "growth"}
    assert result.remembered_values == {"weekly-context": Decimal(160)}
    assert result.selection_outputs == {"selected-growth": ("SCHG", "SOXX")}
    assert set(result.target_weights) == {"SCHG", "SOXX"}
    assert sum(result.target_weights.values()) == Decimal(1)


def test_codegen_orders_state_before_policy_and_selection_before_allocation() -> None:
    plan = compile_v2_strategy_to_lean_plan(composable_semantic_execution_strategy())
    source = generate_csharp(
        plan, CSharpGenerationSettings(snapshot_id="composable-unit@1"),
    )
    event = source.index('"state_transition", "transition"')
    policy = source.index('"policy", "policy_decision"')
    selection = source.index('"selection_fallback", "selection"')
    allocation = source.index('"allocation_aggregation", "allocation"')
    checkpoint = source.index('"checkpoint", "checkpoint"')
    assert event < policy
    assert selection < allocation < checkpoint
    assert "Composable weekly regime weighted momentum" not in source


def test_lowering_is_structural_not_metadata_or_fixture_name_driven() -> None:
    strategy = composable_semantic_execution_strategy().model_copy(update={
        "metadata": composable_semantic_execution_strategy().metadata.model_copy(update={
            "name": "Arbitrary renamed strategy",
        }),
    })
    plan = compile_v2_strategy_to_lean_plan(strategy)
    assert plan.temporal_program is not None
    assert plan.temporal_program.profile == "composable-semantic-execution@1"


def test_two_independent_investments_keep_separate_rankings_then_aggregate() -> None:
    plan = compile_v2_strategy_to_lean_plan(composable_split_execution_strategy())
    assert len(plan.momentum_selections) == 2
    assert len({item.id for item in plan.momentum_selections}) == 2
    primary = plan.temporal_program.policy_targets[-1]
    assert primary.allocation_method == "fixed"
    assert tuple(leg.weight for leg in primary.legs) == (Decimal("0.6"), Decimal("0.4"))
    source = generate_csharp(plan)
    assert source.count('"selection_fallback", "selection"') == 2
    assert '"method", "fixed"' in source
    # Eligibility is explicit Program meaning.  An unqualified sleeve must
    # rank ready negative returns too, rather than inheriting a legacy UI
    # momentum filter.
    assert "var eligible0 = scores0.Where(item => true).ToList();" in source
    assert "var eligible1 = scores1.Where(item => true).ToList();" in source


def test_completed_weekly_context_does_not_look_ahead() -> None:
    snapshot = _snapshot()
    result = execute_program_v2(
        composable_semantic_execution_program(), snapshot, cutoff_index=0,
    )
    assert result.state == {"regime": "defensive"}
    assert result.remembered_values == {}
    assert result.target_weights == {"TLT": Decimal(1)}


def test_program_statement_order_is_observable_not_reordered_by_lowering() -> None:
    program = composable_semantic_execution_program()
    selection, weekly, confirmation, policy = program.statements
    reordered = program.model_copy(update={
        "statements": (selection, confirmation, weekly, policy),
    })
    result = execute_program_v2(reordered, _snapshot(), cutoff_index=64)
    assert result.state == {"regime": "armed"}
    assert result.target_weights == {"TLT": Decimal(1)}


def test_selection_shortage_uses_explicit_fallback_before_allocation() -> None:
    snapshot = _snapshot()
    series = dict(snapshot.series)
    for symbol in ("VGT", "SOXX", "SCHG"):
        values = list(series[symbol]["close:adjusted"])
        values[1] = Decimal(0)
        series[symbol] = {"close:adjusted": tuple(values)}
    degraded = replace(snapshot, series=series)
    result = execute_program_v2(
        composable_semantic_execution_program(), degraded, cutoff_index=64,
    )
    assert result.selection_outputs == {"selected-growth": ("TLT",)}
    assert result.target_weights == {"TLT": Decimal(1)}
