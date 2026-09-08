from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def test_golden_requirements_are_explicit_and_deduplicated() -> None:
    strategy_ir = lower_strategy_model_to_ir(golden_portfolio_strategy())
    requirements = analyze_strategy_ir(strategy_ir)

    assert requirements.assets == ("IEF", "QQQ", "SCHG", "SOXX", "TLT", "VGT")
    assert [(item.source_component_id, item.operation, item.day) for item in requirements.schedules] == [
        ("monthly", "schedule.monthly", 1)
    ]
    assert requirements.operations == (
        "market.asset_set",
        "portfolio.equal_weight",
        "portfolio.merge_targets",
        "portfolio.rebalance",
        "schedule.monthly",
        "selection.random_n",
    )
    assert [(item.source_component_id, item.resample) for item in requirements.random_selections] == [
        ("growth_random", "per_event")
    ]
