from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

import pytest

from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.compiler.lean.momentum_e2e import SYMBOLS, verify_momentum_e2e
from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.ir.strategy import IRValidationError, TopNOp, TrailingReturnOp, validate_strategy_ir
from ruletrade.strategy.v1.fixtures import momentum_top_n_strategy
from ruletrade.strategy.v1.momentum import evaluate_trailing_return_top_n
from ruletrade.strategy.v1.validation import validate_strategy_v1


def test_reference_trailing_return_ranks_descending_with_stable_ties() -> None:
    result = evaluate_trailing_return_top_n(
        {
            "VGT": [Decimal(100), Decimal(110)],
            "QQQ": [Decimal(100), Decimal(110)],
            "SOXX": [Decimal(100), Decimal(120)],
        },
        lookback_bars=1,
        count=2,
    )

    assert dict(result.scores) == {
        "QQQ": Decimal("0.1"),
        "SOXX": Decimal("0.2"),
        "VGT": Decimal("0.1"),
    }
    assert result.ranked == ("SOXX", "QQQ", "VGT")
    assert result.selected == ("SOXX", "QQQ")
    assert dict(result.targets) == {"QQQ": Decimal("0.5"), "SOXX": Decimal("0.5")}


def test_reference_requires_full_comparable_lookback() -> None:
    result = evaluate_trailing_return_top_n(
        {"QQQ": [Decimal(100), Decimal(101)], "VGT": [Decimal(100)]},
        lookback_bars=1,
        count=2,
    )

    assert result.selected == ()
    assert result.targets == ()
    assert result.ranked == ("QQQ",)


def test_momentum_source_desugars_to_typed_ir_and_requirements() -> None:
    strategy = momentum_top_n_strategy()
    validate_strategy_v1(strategy)
    strategy_ir = lower_strategy_model_to_ir(strategy)
    trailing = next(op for op in strategy_ir.operations if isinstance(op, TrailingReturnOp))
    top_n = next(op for op in strategy_ir.operations if isinstance(op, TopNOp))
    requirements = analyze_strategy_ir(strategy_ir)

    assert trailing.lookback_bars == 126
    assert trailing.provenance.component_id == "momentum"
    assert top_n.count == 2
    assert top_n.provenance.component_id == "top_n"
    assert requirements.assets == ("QQQ", "SCHG", "SOXX", "VGT")
    assert len(requirements.daily_history) == 1
    history = requirements.daily_history[0]
    assert history.symbols == ("QQQ", "VGT", "SOXX", "SCHG")
    assert history.lookback_bars == 126
    assert history.observation_count == 127
    assert history.price_field == "adjusted_close"
    assert history.resolution == "daily"


def test_momentum_lowers_to_lean_plan_and_codegen_without_source_leakage() -> None:
    plan = compile_strategy_to_lean_plan(momentum_top_n_strategy())
    selection = plan.momentum_selections[0]

    assert plan.random_selections == ()
    assert selection.symbols == ("QQQ", "VGT", "SOXX", "SCHG")
    assert selection.lookback_bars == 126
    assert selection.count == 2
    source = generate_csharp(plan)
    assert "SetWarmUp(126, Resolution.Daily);" in source
    assert "DataNormalizationMode.Adjusted" in source
    assert "window[0] / window[126] - 1m" in source
    assert ".OrderByDescending(item => item.Value)" in source
    assert ".ThenBy(item => item.Key, StringComparer.Ordinal)" in source
    assert ".Take(2)" in source
    assert "RULETRADE_MOMENTUM|" in source
    assert "RuleTradeRandom" not in source
    assert source.index("_dailyCloses[item.Key].Add(bar.Close);") < source.index(
        "ExecuteEvent0(eventIdentity);"
    )


def test_top_n_edit_changes_source_identity_and_compiled_selection() -> None:
    original = momentum_top_n_strategy()
    payload = deepcopy(original.model_dump(mode="json"))
    top_n = next(item for item in payload["graph"]["components"] if item["id"] == "top_n")
    top_n["config"]["count"] = 3
    edited = type(original).model_validate(payload)

    original_plan = compile_strategy_to_lean_plan(original)
    edited_plan = compile_strategy_to_lean_plan(edited)
    assert original_plan.strategy_identity != edited_plan.strategy_identity
    assert original_plan.momentum_selections[0].count == 2
    assert edited_plan.momentum_selections[0].count == 3
    assert ".Take(3)" in generate_csharp(edited_plan)


def test_invalid_momentum_ir_is_rejected() -> None:
    strategy_ir = lower_strategy_model_to_ir(momentum_top_n_strategy())
    operations = tuple(
        replace(operation, lookback_bars=0)
        if isinstance(operation, TrailingReturnOp)
        else operation
        for operation in strategy_ir.operations
    )

    with pytest.raises(IRValidationError, match="lookback must be positive"):
        validate_strategy_ir(replace(strategy_ir, operations=operations))


def test_momentum_acceptance_trace_matches_reference_oracle() -> None:
    fixture = Path(__file__).parent / "fixtures" / "lean-data"
    closes: dict[str, list[Decimal]] = {}
    dates: list[str] = []
    for symbol in SYMBOLS:
        lower = symbol.lower()
        with ZipFile(fixture / "equity" / "usa" / "daily" / f"{lower}.zip") as archive:
            rows = [row.split(",") for row in archive.read(f"{lower}.csv").decode().splitlines()]
        dates = [row[0][:8] for row in rows]
        closes[symbol] = [Decimal(row[4]) for row in rows]
    events = (
        "20240102", "20240201", "20240301", "20240401", "20240501", "20240603",
        "20240701", "20240801", "20240903", "20241001", "20241101", "20241202",
    )
    lines = ["Algorithm Id: test completed"]
    for event in events:
        index = dates.index(event)
        result = evaluate_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            count=2,
        )
        identity = f"{event[:4]}-{event[4:6]}-{event[6:]}"
        scores = ",".join(f"{symbol}={value}" for symbol, value in result.scores)
        ranked = ",".join(result.ranked)
        selected = ",".join(result.selected)
        weights = ",".join(f"{symbol}={value}" for symbol, value in result.targets)
        lines.append(
            f"RULETRADE_MOMENTUM|{identity}|scores={scores}|ranked={ranked}|selected={selected}"
        )
        lines.append(
            f"RULETRADE_TARGETS|{identity}|selected={','.join(sorted(result.selected))}|weights={weights}"
        )
    result_payload = json.loads(
        (Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json")
        .read_text()
    )

    assert verify_momentum_e2e("\n".join(lines), result_payload, fixture) == (12, 1)
