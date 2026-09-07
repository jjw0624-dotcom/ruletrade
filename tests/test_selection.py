from ruletrade.core.selection import select_symbols
from ruletrade.strategy.models import (
    AllSelection,
    RandomNSelection,
)


def test_all_selection_returns_all_symbols() -> None:
    universe = ["QQQ", "VGT", "SOXX"]

    result = select_symbols(
        universe,
        AllSelection(),
        seed=123,
    )

    assert result == universe


def test_random_selection_is_deterministic() -> None:
    universe = [
        "QQQ",
        "VGT",
        "SOXX",
        "SCHG",
    ]

    selection = RandomNSelection(count=2)

    first = select_symbols(
        universe,
        selection,
        seed=123,
    )

    second = select_symbols(
        universe,
        selection,
        seed=123,
    )

    assert first == second
    assert len(first) == 2
