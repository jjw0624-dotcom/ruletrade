from ruletrade.compile_plan import build_bt_plan
from ruletrade.domain import SimpleStrategySpec


def test_monthly_plan_has_expected_steps() -> None:
    spec = SimpleStrategySpec.model_validate(
        {
            "name": "dca",
            "initial_capital": "10000",
            "recurring_contribution": {"amount": "500"},
            "assets": [
                {"symbol": "QQQ", "weight": "0.4"},
                {"symbol": "VOO", "weight": "0.6"},
            ],
        }
    )
    plan = build_bt_plan(spec)
    assert plan.schedule == "initial_then_monthly"
    assert [step.name for step in plan.steps] == [
        "RuleTradeSchedule",
        "SelectAll",
        "WeighSpecified",
        "Rebalance",
    ]
