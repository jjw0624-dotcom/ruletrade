from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean import generate_csharp
from ruletrade.compiler.lean.fallback_e2e import verify_fallback_e2e
from ruletrade.compiler.lean.filter_e2e import load_filter_fixture_closes
from ruletrade.ir.strategy import (
    AssetSetOp,
    EqualWeightOp,
    FirstNonEmptyTargetsOp,
    IRValidationError,
    validate_strategy_ir,
)
from ruletrade.strategy.v1.fixtures import fallback_momentum_strategy
from ruletrade.strategy.v1.momentum import evaluate_fallback_trailing_return_top_n
from ruletrade.strategy.v1.validation import StrategySemanticError, validate_strategy_v1


def test_source_preserves_explicit_fallback_intent() -> None:
    strategy = fallback_momentum_strategy()
    validate_strategy_v1(strategy)

    component = next(item for item in strategy.graph.components if item.id == "fallback")
    definition = next(
        item
        for item in strategy.definitions.asset_sets
        if item.id == component.config["fallback_asset_set_ref"]
    )
    assert component.primitive == "fallback@1"
    assert definition.assets == ["TLT"]


@pytest.mark.parametrize(
    ("reference", "message"),
    [("missing", "unknown asset set"), ("", "value does not match string")],
)
def test_source_rejects_invalid_fallback_reference(reference: str, message: str) -> None:
    payload = deepcopy(fallback_momentum_strategy().model_dump(mode="json"))
    component = next(item for item in payload["graph"]["components"] if item["id"] == "fallback")
    component["config"]["fallback_asset_set_ref"] = reference

    with pytest.raises(StrategySemanticError, match=message):
        validate_strategy_v1(type(fallback_momentum_strategy()).model_validate(payload))


def test_source_rejects_multiple_fallback_assets() -> None:
    payload = deepcopy(fallback_momentum_strategy().model_dump(mode="json"))
    definition = next(
        item for item in payload["definitions"]["asset_sets"] if item["id"] == "fallback_tlt"
    )
    definition["assets"] = ["TLT", "IEF"]

    with pytest.raises(StrategySemanticError, match="exactly one asset"):
        validate_strategy_v1(type(fallback_momentum_strategy()).model_validate(payload))


def test_source_rejects_unfiltered_primary_for_fallback_v0() -> None:
    payload = deepcopy(fallback_momentum_strategy().model_dump(mode="json"))
    payload["graph"]["components"] = [
        item for item in payload["graph"]["components"] if item["id"] != "positive_return"
    ]
    payload["graph"]["connections"] = [
        item
        for item in payload["graph"]["connections"]
        if item["source"]["component_id"] != "positive_return"
        and item["target"]["component_id"] != "positive_return"
    ]
    payload["graph"]["connections"].append(
        {
            "source": {"component_id": "momentum", "port": "scores"},
            "target": {"component_id": "momentum_rank", "port": "scores"},
        }
    )

    with pytest.raises(StrategySemanticError, match="must use filtered Top N"):
        validate_strategy_v1(type(fallback_momentum_strategy()).model_validate(payload))


def test_fallback_desugars_to_existing_ops_plus_first_non_empty_targets() -> None:
    strategy_ir = lower_strategy_model_to_ir(fallback_momentum_strategy())
    operation = next(
        item for item in strategy_ir.operations if isinstance(item, FirstNonEmptyTargetsOp)
    )
    fallback_assets = next(
        item
        for item in strategy_ir.operations
        if isinstance(item, AssetSetOp) and item.id == "fallback$assets"
    )
    fallback_targets = next(
        item
        for item in strategy_ir.operations
        if isinstance(item, EqualWeightOp) and item.id == "fallback$targets"
    )

    assert operation.primary == "weights"
    assert operation.fallback == "fallback$targets"
    assert operation.provenance.component_id == "fallback"
    assert fallback_assets.symbols == ("TLT",)
    assert fallback_assets.provenance.component_id == "fallback"
    assert fallback_targets.assets == fallback_assets.id
    assert fallback_targets.total_weight == Decimal(1)
    assert fallback_targets.provenance.component_id == "fallback"
    assert not any(item.operation == "targets.fallback_asset" for item in strategy_ir.operations)


def test_ir_rejects_same_primary_and_fallback_targets() -> None:
    strategy_ir = lower_strategy_model_to_ir(fallback_momentum_strategy())
    operations = tuple(
        replace(item, fallback=item.primary)
        if isinstance(item, FirstNonEmptyTargetsOp)
        else item
        for item in strategy_ir.operations
    )

    with pytest.raises(IRValidationError, match="must differ"):
        validate_strategy_ir(replace(strategy_ir, operations=operations))


def test_requirements_separate_fallback_subscription_from_momentum_history() -> None:
    requirements = analyze_strategy_ir(
        lower_strategy_model_to_ir(fallback_momentum_strategy())
    )

    assert requirements.assets == ("QQQ", "SCHG", "SOXX", "TLT", "VGT")
    assert requirements.operations.count("portfolio.first_non_empty_targets") == 1
    assert len(requirements.daily_history) == 1
    assert requirements.daily_history[0].symbols == ("QQQ", "VGT", "SOXX", "SCHG")
    assert "TLT" not in requirements.daily_history[0].symbols
    assert requirements.daily_history[0].observation_count == 127


def test_fallback_lowers_to_typed_lean_plan_and_generated_branch() -> None:
    plan = compile_strategy_to_lean_plan(fallback_momentum_strategy())
    sleeve = plan.target_sleeves[0]
    source = generate_csharp(plan)

    assert tuple(item.symbol for item in plan.subscriptions) == (
        "QQQ", "SCHG", "SOXX", "TLT", "VGT",
    )
    assert sleeve.fallback_component_id == "fallback"
    assert sleeve.fallback_symbols == ("TLT",)
    assert 'AddEquity("TLT", Resolution.Daily' in source
    assert '_dailyCloses["TLT"]' not in source
    assert source.count("window[0] / window[126] - 1m") == 1
    assert '"insufficient"' in source
    assert "RULETRADE_FALLBACK|" in source
    assert "RULETRADE_FINAL|" in source
    assert 'new List<string> { "TLT" }' in source
    assert "RULETRADE_MOMENTUM_SKIPPED|" not in source


@pytest.mark.parametrize(
    ("scores", "expected_primary", "fallback_activated", "expected_final"),
    [
        ({"A": "0.4", "B": "0.3", "C": "0.2", "D": "0.1"}, ("A", "B"), False, ("A", "B")),
        ({"A": "0.2", "B": "0.1", "C": "0", "D": "-0.1"}, ("A", "B"), False, ("A", "B")),
        ({"A": "0.2", "B": "0", "C": "-0.1", "D": "-0.2"}, (), True, ("TLT",)),
        ({"A": "0", "B": "0", "C": "-0.1", "D": "-0.2"}, (), True, ("TLT",)),
    ],
)
def test_reference_fallback_requires_complete_primary_selection(
    scores: dict[str, str],
    expected_primary: tuple[str, ...],
    fallback_activated: bool,
    expected_final: tuple[str, ...],
) -> None:
    closes = {
        symbol: [Decimal(1), Decimal(1) + Decimal(score)]
        for symbol, score in scores.items()
    }
    result = evaluate_fallback_trailing_return_top_n(
        closes,
        lookback_bars=1,
        threshold=Decimal(0),
        count=2,
        fallback_asset="tlt",
    )

    assert result.candidate == result.ranked[:2]
    assert result.primary_selected == expected_primary
    assert result.fallback_activated is fallback_activated
    assert result.final_selected == expected_final
    assert sum(dict(result.final_targets).values()) == Decimal(1)


def _synthetic_fallback_log(fixture: Path) -> str:
    dates, closes = load_filter_fixture_closes(fixture)
    events = (
        "20240102", "20240201", "20240301", "20240401", "20240501", "20240603",
        "20240701", "20240801", "20240903", "20241001", "20241101", "20241202",
    )
    lines = ["Algorithm Id: test completed"]
    for event in events:
        index = dates.index(event)
        result = evaluate_fallback_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            threshold=Decimal(0),
            count=2,
            fallback_asset="TLT",
        )
        identity = f"{event[:4]}-{event[4:6]}-{event[6:]}"
        scores = ",".join(f"{symbol}={value}" for symbol, value in result.scores)
        lines.append(
            f"RULETRADE_FILTER|{identity}|threshold=0|eligible={','.join(result.eligible)}"
            f"|rejected={','.join(result.rejected)}"
        )
        primary_decision = "insufficient" if result.fallback_activated else "executed"
        lines.append(
            f"RULETRADE_MOMENTUM|{identity}|scores={scores}|ranked={','.join(result.ranked)}"
            f"|candidate={','.join(result.candidate)}"
            f"|selected={','.join(result.primary_selected)}|decision={primary_decision}"
        )
        fallback_decision = "activated" if result.fallback_activated else "not_activated"
        lines.append(
            f"RULETRADE_FALLBACK|{identity}|component=fallback|asset=TLT"
            f"|decision={fallback_decision}"
        )
        source = "fallback" if result.fallback_activated else "primary"
        lines.append(
            f"RULETRADE_FINAL|{identity}|selected={','.join(result.final_selected)}"
            f"|decision=executed|source={source}"
        )
        weights = ",".join(f"{symbol}={value}" for symbol, value in result.final_targets)
        lines.append(
            f"RULETRADE_TARGETS|{identity}|selected={','.join(sorted(result.final_selected))}"
            f"|weights={weights}"
        )
    return "\n".join(lines)


def test_fallback_e2e_verifier_compares_every_semantic_stage() -> None:
    fixture = Path(__file__).parent / "fixtures" / "lean-filter-data"
    result_payload = json.loads(
        (Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json")
        .read_text()
    )
    log_text = _synthetic_fallback_log(fixture)

    assert verify_fallback_e2e(log_text, result_payload, fixture) == (12, 7, 5, 1)
    malformed = log_text.replace("|selected=", "|selected=TLT", 1)
    with pytest.raises(ValueError, match="primary selection mismatch"):
        verify_fallback_e2e(malformed, result_payload, fixture)
