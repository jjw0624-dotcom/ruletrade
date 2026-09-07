from ruletrade.domain import SimpleStrategySpec
from ruletrade.hashing import strategy_hash


def test_asset_order_does_not_change_semantic_hash() -> None:
    first = SimpleStrategySpec.model_validate(
        {
            "name": "name-a",
            "initial_capital": "10000",
            "assets": [
                {"symbol": "QQQ", "weight": "0.4"},
                {"symbol": "VOO", "weight": "0.6"},
            ],
        }
    )
    second = SimpleStrategySpec.model_validate(
        {
            "name": "name-b",
            "initial_capital": "10000.0",
            "assets": [
                {"symbol": "VOO", "weight": "0.60"},
                {"symbol": "QQQ", "weight": "0.40"},
            ],
        }
    )
    assert strategy_hash(first) == strategy_hash(second)
