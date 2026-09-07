from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.compiler.lean.lowering import lower_to_lean_plan
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def test_golden_strategy_compiles_through_to_classic_qcalgorithm_source() -> None:
    source = generate_csharp(lower_to_lean_plan(golden_portfolio_strategy()))

    assert "public class RuleTradeGeneratedAlgorithm : QCAlgorithm" in source
    assert source.count("AddEquity(") == 6
    assert "DateRules.MonthStart" in source
    assert "RuleTradeRandom.Sample" in source
    assert "SetHoldings(target.Key, target.Value)" in source
    assert "RULETRADE_TARGETS|" in source
    assert "AlphaModel" not in source
    assert "CanonicalStrategyV1" not in source


def test_codegen_is_stable_for_a_normalized_plan() -> None:
    plan = lower_to_lean_plan(golden_portfolio_strategy())

    assert generate_csharp(plan) == generate_csharp(plan)
