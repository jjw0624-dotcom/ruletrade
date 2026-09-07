import pytest
from pydantic import ValidationError

from ruletrade.strategy.models import StrategyDocument


def valid_strategy() -> StrategyDocument:
    return StrategyDocument.model_validate(
        {
            "name": "group-demo",
            "random_seed": 123,
            "groups": [
                {
                    "id": "growth",
                    "weight": "0.7",
                    "universe": [
                        "qqq",
                        "vgt",
                        "soxx",
                        "schg",
                    ],
                    "selection": {
                        "type": "random_n",
                        "count": 2,
                    },
                    "allocation": {
                        "type": "equal_weight",
                    },
                },
                {
                    "id": "safe",
                    "weight": "0.3",
                    "universe": [
                        "tlt",
                        "ief",
                    ],
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
    )


def test_normalizes_group_symbols() -> None:
    strategy = valid_strategy()

    assert strategy.groups[0].universe == [
        "QQQ",
        "VGT",
        "SOXX",
        "SCHG",
    ]


def test_rejects_duplicate_group_ids() -> None:
    payload = valid_strategy().model_dump(mode="json")

    payload["groups"][1]["id"] = "growth"

    with pytest.raises(
        ValidationError,
        match="group ids must be unique",
    ):
        StrategyDocument.model_validate(payload)


def test_rejects_bad_group_weight_sum() -> None:
    payload = valid_strategy().model_dump(mode="json")

    payload["groups"][0]["weight"] = "0.6"

    with pytest.raises(
        ValidationError,
        match="group weights must sum to 1",
    ):
        StrategyDocument.model_validate(payload)


def test_rejects_random_count_above_universe_size() -> None:
    payload = valid_strategy().model_dump(mode="json")

    payload["groups"][0]["selection"]["count"] = 10

    with pytest.raises(
        ValidationError,
        match="cannot exceed group universe size",
    ):
        StrategyDocument.model_validate(payload)
