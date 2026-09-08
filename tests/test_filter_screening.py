from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

import pytest

from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.compiler.lean.filter_e2e import SYMBOLS, verify_filter_e2e
from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
from ruletrade.ir.strategy import FilterOp, IRValidationError, validate_strategy_ir
from ruletrade.strategy.v1.fixtures import filter_screening_strategy
from ruletrade.strategy.v1.momentum import evaluate_filtered_trailing_return_top_n
from ruletrade.strategy.v1.validation import validate_strategy_v1


def test_reference_filter_is_strict_and_preserves_scores() -> None:
    result = evaluate_filtered_trailing_return_top_n(
        {
            "POSITIVE": [Decimal("1"), Decimal("1.0001")],
            "ZERO": [Decimal("1"), Decimal("1")],
            "NEGATIVE": [Decimal("1"), Decimal("0.9999")],
            "INCOMPLETE": [Decimal("1")],
        },
        lookback_bars=1,
        threshold=Decimal(0),
        count=1,
    )

    assert dict(result.scores) == {
        "NEGATIVE": Decimal("-0.0001"),
        "POSITIVE": Decimal("0.0001"),
        "ZERO": Decimal(0),
    }
    assert result.eligible == ("POSITIVE",)
    assert result.rejected == ("NEGATIVE", "ZERO")
    assert result.ranked == ("POSITIVE",)
    assert result.selected == ("POSITIVE",)


def test_reference_filter_ranks_only_eligible_scores_and_skips_below_top_n() -> None:
    successful = evaluate_filtered_trailing_return_top_n(
        {
            "QQQ": [Decimal(100), Decimal(112)],
            "VGT": [Decimal(100), Decimal(97)],
            "SOXX": [Decimal(100), Decimal(105)],
            "SCHG": [Decimal(100), Decimal(120)],
        },
        lookback_bars=1,
        threshold=Decimal(0),
        count=2,
    )
    skipped = evaluate_filtered_trailing_return_top_n(
        {"QQQ": [Decimal(100), Decimal(101)], "VGT": [Decimal(100), Decimal(99)]},
        lookback_bars=1,
        threshold=Decimal(0),
        count=2,
    )

    assert successful.eligible == ("QQQ", "SCHG", "SOXX")
    assert successful.ranked == ("SCHG", "QQQ", "SOXX")
    assert successful.selected == ("SCHG", "QQQ")
    assert dict(successful.targets) == {"QQQ": Decimal("0.5"), "SCHG": Decimal("0.5")}
    assert skipped.eligible == ("QQQ",)
    assert skipped.selected == ()
    assert skipped.targets == ()


def test_filter_source_desugars_to_typed_ir_without_new_collection_type() -> None:
    strategy = filter_screening_strategy()
    validate_strategy_v1(strategy)
    strategy_ir = lower_strategy_model_to_ir(strategy)
    operation = next(item for item in strategy_ir.operations if isinstance(item, FilterOp))

    assert operation.scores == "momentum"
    assert operation.operator == "gt"
    assert operation.threshold == Decimal(0)
    assert operation.provenance.component_id == "positive_return"


def test_invalid_source_threshold_fails_authoritative_validation() -> None:
    strategy = filter_screening_strategy()
    payload = deepcopy(strategy.model_dump(mode="json"))
    component = next(
        item for item in payload["graph"]["components"] if item["id"] == "positive_return"
    )
    component["config"]["threshold"] = "not-a-number"

    with pytest.raises(ValueError, match="threshold"):
        validate_strategy_v1(type(strategy).model_validate(payload))


def test_filter_reuses_trailing_return_history_requirement() -> None:
    requirements = analyze_strategy_ir(lower_strategy_model_to_ir(filter_screening_strategy()))

    assert requirements.operations.count("selection.filter") == 1
    assert len(requirements.daily_history) == 1
    assert requirements.daily_history[0].lookback_bars == 126
    assert requirements.daily_history[0].observation_count == 127


def test_filter_lowers_to_one_score_calculation_then_filter_rank_and_top_n() -> None:
    plan = compile_strategy_to_lean_plan(filter_screening_strategy())
    selection = plan.momentum_selections[0]

    assert selection.filter_component_id == "positive_return"
    assert selection.filter_operator == "gt"
    assert selection.filter_threshold == Decimal(0)
    source = generate_csharp(plan)
    assert source.count("window[0] / window[126] - 1m") == 1
    assert ".Where(item => item.Value > 0m)" in source
    assert "RULETRADE_FILTER|" in source
    assert source.index("var scores0_0_0") < source.index("var eligibleScores0_0_0")
    assert source.index("var eligibleScores0_0_0") < source.index("var ranked0_0_0")
    assert 'Debug("RULETRADE_MOMENTUM_SKIPPED|' in source
    assert "return;" in source


def test_invalid_filter_ir_is_rejected() -> None:
    strategy_ir = lower_strategy_model_to_ir(filter_screening_strategy())
    operations = tuple(
        replace(item, operator="gte") if isinstance(item, FilterOp) else item
        for item in strategy_ir.operations
    )

    with pytest.raises(IRValidationError, match="only strict gt filter is supported"):
        validate_strategy_ir(replace(strategy_ir, operations=operations))


def test_threshold_edit_changes_semantic_identity_and_generated_predicate() -> None:
    original = filter_screening_strategy()
    payload = deepcopy(original.model_dump(mode="json"))
    component = next(
        item for item in payload["graph"]["components"] if item["id"] == "positive_return"
    )
    component["config"]["threshold"] = "0.05"
    edited = type(original).model_validate(payload)

    original_plan = compile_strategy_to_lean_plan(original)
    edited_plan = compile_strategy_to_lean_plan(edited)
    assert original_plan.strategy_identity != edited_plan.strategy_identity
    assert edited_plan.momentum_selections[0].filter_threshold == Decimal("0.05")
    assert ".Where(item => item.Value > 0.05m)" in generate_csharp(edited_plan)


def _fixture_data() -> tuple[list[str], dict[str, list[Decimal]]]:
    fixture = Path(__file__).parent / "fixtures" / "lean-filter-data"
    closes: dict[str, list[Decimal]] = {}
    dates: list[str] = []
    for symbol in SYMBOLS:
        lower = symbol.lower()
        with ZipFile(fixture / "equity" / "usa" / "daily" / f"{lower}.zip") as archive:
            rows = [row.split(",") for row in archive.read(f"{lower}.csv").decode().splitlines()]
        dates = [row[0][:8] for row in rows]
        closes[symbol] = [Decimal(row[4]) for row in rows]
        assert all(len(row[0]) == 14 and row[0].endswith(" 00:00") for row in rows)
    return dates, closes


def test_filter_fixture_and_acceptance_trace_cover_success_and_skip() -> None:
    dates, closes = _fixture_data()
    events = (
        "20240102", "20240201", "20240301", "20240401", "20240501", "20240603",
        "20240701", "20240801", "20240903", "20241001", "20241101", "20241202",
    )
    lines = ["Algorithm Id: test completed"]
    successful = skipped = 0
    for event in events:
        index = dates.index(event)
        result = evaluate_filtered_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            threshold=Decimal(0),
            count=2,
        )
        identity = f"{event[:4]}-{event[4:6]}-{event[6:]}"
        scores = ",".join(f"{symbol}={value}" for symbol, value in result.scores)
        lines.append(
            f"RULETRADE_FILTER|{identity}|threshold=0|eligible={','.join(result.eligible)}"
            f"|rejected={','.join(result.rejected)}"
        )
        lines.append(
            f"RULETRADE_MOMENTUM|{identity}|scores={scores}|ranked={','.join(result.ranked)}"
            f"|selected={','.join(result.selected)}"
        )
        if result.selected:
            successful += 1
            weights = ",".join(f"{symbol}={value}" for symbol, value in result.targets)
            lines.append(
                f"RULETRADE_TARGETS|{identity}|selected={','.join(sorted(result.selected))}"
                f"|weights={weights}"
            )
        else:
            skipped += 1
            lines.append(
                f"RULETRADE_MOMENTUM_SKIPPED|{identity}|eligible={len(result.eligible)}"
            )
    result_payload = json.loads(
        (Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json")
        .read_text()
    )

    assert successful > 0
    assert skipped > 0
    assert verify_filter_e2e(
        "\n".join(lines),
        result_payload,
        Path(__file__).parent / "fixtures" / "lean-filter-data",
    ) == (12, successful, skipped, 1)


def test_filter_fixture_is_reproducibly_generated(tmp_path: Path) -> None:
    generated = tmp_path / "filter-data"
    generator = Path(__file__).parents[1] / "scripts" / "generate_golden_lean_fixture.py"
    subprocess.run(
        [
            sys.executable,
            str(generator),
            "--profile",
            "filter",
            "--output",
            str(generated),
        ],
        check=True,
    )
    tracked = Path(__file__).parent / "fixtures" / "lean-filter-data"

    for path in tracked.rglob("*"):
        if path.is_file():
            assert (generated / path.relative_to(tracked)).read_bytes() == path.read_bytes()
