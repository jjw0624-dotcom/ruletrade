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


def test_core_strategy_hash_is_deterministic() -> None:
    from ruletrade.strategy.models import StrategyDocument

    payload = {
        "name": "hash-demo",
        "random_seed": 123,
        "groups": [
            {
                "id": "growth",
                "weight": "0.7",
                "universe": ["QQQ", "SOXX"],
                "selection": {
                    "type": "all",
                },
                "allocation": {
                    "type": "equal_weight",
                },
            },
            {
                "id": "safe",
                "weight": "0.3",
                "universe": ["TLT", "IEF"],
                "selection": {
                    "type": "all",
                },
                "allocation": {
                    "type": "equal_weight",
                },
            },
        ],
        "rebalance": {
            "type": "monthly",
        },
    }

    first = StrategyDocument.model_validate(payload)
    second = StrategyDocument.model_validate(payload)

    assert strategy_hash(first) == strategy_hash(second)


def test_core_strategy_hash_changes_with_semantics() -> None:
    from ruletrade.strategy.models import StrategyDocument

    first = StrategyDocument.model_validate(
        {
            "name": "hash-demo",
            "random_seed": 123,
            "groups": [
                {
                    "id": "portfolio",
                    "weight": "1",
                    "universe": ["QQQ", "VOO"],
                    "selection": {
                        "type": "random_n",
                        "count": 1,
                        "resample": "per_event",
                    },
                    "allocation": {
                        "type": "equal_weight",
                    },
                }
            ],
            "rebalance": {
                "type": "monthly",
            },
        }
    )

    payload = first.model_dump(mode="json")
    payload["random_seed"] = 456

    second = StrategyDocument.model_validate(payload)

    assert strategy_hash(first) != strategy_hash(second)


def test_core_strategy_name_does_not_change_hash() -> None:
    from ruletrade.strategy.models import StrategyDocument

    first = StrategyDocument.model_validate(
        {
            "name": "first-name",
            "random_seed": 123,
            "groups": [
                {
                    "id": "portfolio",
                    "weight": "1",
                    "universe": ["QQQ", "VOO"],
                    "selection": {
                        "type": "all",
                    },
                    "allocation": {
                        "type": "equal_weight",
                    },
                }
            ],
            "rebalance": {
                "type": "monthly",
            },
        }
    )

    payload = first.model_dump(mode="json")
    payload["name"] = "renamed-strategy"

    second = StrategyDocument.model_validate(payload)

    assert strategy_hash(first) == strategy_hash(second)
