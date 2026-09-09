from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def test_golden_strategy_compiles_through_to_classic_qcalgorithm_source() -> None:
    source = generate_csharp(compile_strategy_to_lean_plan(golden_portfolio_strategy()))

    assert "using QuantConnect.Indicators;" not in source
    assert "public class RuleTradeGeneratedAlgorithm : QCAlgorithm" in source
    assert source.count("AddEquity(") == 6
    assert "DateRules.MonthStart" in source
    assert "TimeRules.AfterMarketOpen" in source
    assert "QueueEvent0" in source
    assert "public override void OnData(Slice slice)" in source
    assert "slice.Bars.ContainsKey(symbol)" in source
    assert "Securities[symbol].HasData" in source
    assert "Securities[symbol].Price > 0m" in source
    assert "ExecuteEvent0(eventIdentity)" in source
    assert "RuleTradeRandom.Sample" in source
    assert "SetHoldings(target.Key, target.Value)" in source
    assert "RULETRADE_TARGETS|" in source
    assert "RULETRADE_EVIDENCE_V1|" in source
    assert 'EmitDecisionEvidence(eventIdentity, "selection", "random_selection"' in source
    assert 'EmitDecisionEvidence(eventIdentity, "portfolio_execution", "final_targets"' in source
    assert "AlphaModel" not in source
    assert "CanonicalStrategyV1" not in source


def test_scheduled_callback_only_queues_until_daily_data_is_ready() -> None:
    source = generate_csharp(compile_strategy_to_lean_plan(golden_portfolio_strategy()))
    queue_method = source.split("private void QueueEvent0()", 1)[1].split(
        "public override void OnData", 1
    )[0]
    on_data_method = source.split("public override void OnData", 1)[1].split(
        "private bool Event0DataIsReady", 1
    )[0]

    assert "_pendingEvent0 =" in queue_method
    assert "SetHoldings" not in queue_method
    assert "Event0DataIsReady(slice)" in on_data_method
    assert "ExecuteEvent0(eventIdentity)" in on_data_method


def test_codegen_is_stable_for_a_normalized_plan() -> None:
    plan = compile_strategy_to_lean_plan(golden_portfolio_strategy())

    assert generate_csharp(plan) == generate_csharp(plan)
