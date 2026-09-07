from copy import deepcopy

import pytest

from ruletrade.strategy.v1.fixtures import GOLDEN_PORTFOLIO_PAYLOAD
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.randomness import deterministic_random_seed


def strategy() -> CanonicalStrategyV1:
    return CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)


def test_per_event_seed_is_reproducible() -> None:
    first = deterministic_random_seed(
        strategy(),
        "growth_random",
        event_identity="2026-09",
    )
    second = deterministic_random_seed(
        strategy(),
        "growth_random",
        event_identity="2026-09",
    )

    assert first == second


def test_per_event_seed_changes_with_event_identity() -> None:
    september = deterministic_random_seed(
        strategy(), "growth_random", event_identity="2026-09"
    )
    october = deterministic_random_seed(
        strategy(), "growth_random", event_identity="2026-10"
    )

    assert september != october


def test_once_seed_ignores_event_identity() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][2]["config"]["resample"] = "once"
    once = CanonicalStrategyV1.model_validate(payload)

    september = deterministic_random_seed(
        once, "growth_random", event_identity="2026-09"
    )
    october = deterministic_random_seed(
        once, "growth_random", event_identity="2026-10"
    )

    assert september == october


def test_parameter_bindings_affect_seed() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["definitions"]["parameters"] = [
        {"id": "selection_count", "value_type": "integer", "default": 1}
    ]
    parameterized = CanonicalStrategyV1.model_validate(payload)
    first = deterministic_random_seed(
        parameterized,
        "growth_random",
        event_identity="2026-09",
        parameter_bindings={"selection_count": 1},
    )
    second = deterministic_random_seed(
        parameterized,
        "growth_random",
        event_identity="2026-09",
        parameter_bindings={"selection_count": 2},
    )

    assert first != second


def test_explicit_default_binding_has_same_seed_as_implicit_default() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["definitions"]["parameters"] = [
        {"id": "selection_count", "value_type": "integer", "default": 2}
    ]
    parameterized = CanonicalStrategyV1.model_validate(payload)

    implicit = deterministic_random_seed(
        parameterized, "growth_random", event_identity="2026-09"
    )
    explicit = deterministic_random_seed(
        parameterized,
        "growth_random",
        event_identity="2026-09",
        parameter_bindings={"selection_count": 2},
    )

    assert implicit == explicit


def test_per_event_seed_requires_event_identity() -> None:
    with pytest.raises(ValueError, match="requires event identity"):
        deterministic_random_seed(strategy(), "growth_random")
