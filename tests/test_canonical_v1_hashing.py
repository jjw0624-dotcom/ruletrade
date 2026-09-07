from copy import deepcopy

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.fixtures import GOLDEN_PORTFOLIO_PAYLOAD
from ruletrade.strategy.v1.models import CanonicalStrategyV1


def test_v1_metadata_does_not_change_semantic_hash() -> None:
    first = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["metadata"]["name"] = "Renamed"
    payload["metadata"]["description"] = "A presentation-only change"
    second = CanonicalStrategyV1.model_validate(payload)

    assert strategy_hash(first) == strategy_hash(second)


def test_v1_component_order_does_not_change_semantic_hash() -> None:
    first = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"].reverse()
    payload["graph"]["connections"].reverse()
    second = CanonicalStrategyV1.model_validate(payload)

    assert strategy_hash(first) == strategy_hash(second)


def test_v1_semantic_change_changes_hash() -> None:
    first = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][2]["config"]["count"] = 3
    second = CanonicalStrategyV1.model_validate(payload)

    assert strategy_hash(first) != strategy_hash(second)


def test_v1_equivalent_decimal_scales_have_same_hash() -> None:
    first = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][3]["config"]["total"] = "0.7000"
    payload["graph"]["components"][5]["config"]["total"] = "0.300"
    second = CanonicalStrategyV1.model_validate(payload)

    assert strategy_hash(first) == strategy_hash(second)


def test_v1_random_seed_changes_semantic_hash() -> None:
    first = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["random_seed"] = 456
    second = CanonicalStrategyV1.model_validate(payload)

    assert strategy_hash(first) != strategy_hash(second)


def test_v1_implicit_and_explicit_registry_defaults_have_same_hash() -> None:
    explicit = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    del payload["graph"]["components"][0]["config"]["day"]
    del payload["graph"]["components"][2]["config"]["resample"]
    implicit = CanonicalStrategyV1.model_validate(payload)

    assert strategy_hash(explicit) == strategy_hash(implicit)
