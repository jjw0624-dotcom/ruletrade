from ruletrade.compiler.lean.analysis import analyze_dependencies
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def test_golden_dependencies_are_explicit_and_deduplicated() -> None:
    dependencies = analyze_dependencies(golden_portfolio_strategy())

    assert [item.symbol for item in dependencies.subscriptions] == [
        "IEF",
        "QQQ",
        "SCHG",
        "SOXX",
        "TLT",
        "VGT",
    ]
    assert [(item.component_id, item.implementation_id) for item in dependencies.events] == [
        ("monthly", "event.monthly")
    ]
    assert dependencies.primitive_implementations == (
        "allocation.equal_weight",
        "asset_set.named",
        "effect.rebalance",
        "event.monthly",
        "selection.random_n_v1",
        "targets.merge",
    )
    assert dependencies.state_support == ()
    assert dependencies.helper_support == ("python_random_sample", "sha256_seed")
