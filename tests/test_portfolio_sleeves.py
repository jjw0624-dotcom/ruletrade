from __future__ import annotations

import subprocess
import sys
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
from ruletrade.compiler.lean.filter_e2e import load_filter_fixture_closes
from ruletrade.compiler.lean.sleeves_e2e import verify_sleeves_e2e
from ruletrade.ir.strategy import IRValidationError, MergeTargetsOp, ScaleTargetsOp, validate_strategy_ir
from ruletrade.strategy.v1.fixtures import portfolio_sleeves_strategy
from ruletrade.strategy.v1.momentum import evaluate_portfolio_sleeves
from ruletrade.strategy.v1.validation import StrategySemanticError, validate_strategy_v1


def test_source_preserves_portfolio_and_sleeve_authoring_intent() -> None:
    strategy = portfolio_sleeves_strategy()
    validate_strategy_v1(strategy)
    sleeves = [item for item in strategy.graph.components if item.primitive == "portfolio_sleeve@1"]
    assert [(item.id, item.config["name"], item.config["allocation"]) for item in sleeves] == [
        ("growth_sleeve", "Growth", "0.70"),
        ("defensive_sleeve", "Defensive", "0.30"),
    ]
    assert next(item for item in strategy.graph.components if item.id == "portfolio").config == {
        "name": "Portfolio"
    }


def test_source_rejects_non_100_percent_allocations() -> None:
    payload = deepcopy(portfolio_sleeves_strategy().model_dump(mode="json"))
    next(item for item in payload["graph"]["components"] if item["id"] == "growth_sleeve")["config"]["allocation"] = "0.60"
    with pytest.raises(StrategySemanticError, match="must sum to 1"):
        validate_strategy_v1(type(portfolio_sleeves_strategy()).model_validate(payload))


def test_source_rejects_non_sleeve_portfolio_member() -> None:
    payload = deepcopy(portfolio_sleeves_strategy().model_dump(mode="json"))
    connection = next(
        item for item in payload["graph"]["connections"]
        if item["source"]["component_id"] == "defensive_sleeve"
    )
    connection["source"] = {"component_id": "defensive_weights", "port": "targets"}
    with pytest.raises(StrategySemanticError, match="members must be portfolio sleeves"):
        validate_strategy_v1(type(portfolio_sleeves_strategy()).model_validate(payload))


def test_source_rejects_non_normalized_local_targets() -> None:
    payload = deepcopy(portfolio_sleeves_strategy().model_dump(mode="json"))
    next(item for item in payload["graph"]["components"] if item["id"] == "defensive_weights")["config"]["total"] = "0.5"
    with pytest.raises(StrategySemanticError, match="local targets must sum to 1"):
        validate_strategy_v1(type(portfolio_sleeves_strategy()).model_validate(payload))


def test_sleeves_desugar_to_scale_and_existing_merge_only() -> None:
    strategy_ir = lower_strategy_model_to_ir(portfolio_sleeves_strategy())
    scales = [item for item in strategy_ir.operations if isinstance(item, ScaleTargetsOp)]
    merge = next(item for item in strategy_ir.operations if item.id == "portfolio")
    assert [(item.id, item.targets, item.factor, item.provenance.component_id) for item in scales] == [
        ("defensive_sleeve", "defensive_weights", Decimal("0.30"), "defensive_sleeve"),
        ("growth_sleeve", "fallback", Decimal("0.70"), "growth_sleeve"),
    ]
    assert isinstance(merge, MergeTargetsOp)
    assert (merge.left, merge.right) == ("defensive_sleeve", "growth_sleeve")
    assert not any("sleeve" in item.operation for item in strategy_ir.operations)


def test_ir_rejects_invalid_target_scale() -> None:
    strategy_ir = lower_strategy_model_to_ir(portfolio_sleeves_strategy())
    operations = tuple(
        replace(item, factor=Decimal(0)) if isinstance(item, ScaleTargetsOp) else item
        for item in strategy_ir.operations
    )
    with pytest.raises(IRValidationError, match="scale factor"):
        validate_strategy_ir(replace(strategy_ir, operations=operations))


def test_requirements_deduplicate_subscription_and_scope_history() -> None:
    requirements = analyze_strategy_ir(lower_strategy_model_to_ir(portfolio_sleeves_strategy()))
    assert requirements.assets == ("IEF", "QQQ", "SCHG", "SOXX", "TLT", "VGT")
    assert requirements.daily_history[0].symbols == ("QQQ", "VGT", "SOXX", "SCHG")
    assert "portfolio.scale_targets" in requirements.operations
    assert requirements.assets.count("TLT") == 1


def test_lean_plan_is_flat_with_source_sleeve_provenance() -> None:
    plan = compile_strategy_to_lean_plan(portfolio_sleeves_strategy())
    sleeves = {item.source_sleeve_component_id: item for item in plan.target_sleeves}
    assert sleeves["growth_sleeve"].total_weight == Decimal("0.70")
    assert sleeves["growth_sleeve"].local_total_weight == Decimal(1)
    assert sleeves["growth_sleeve"].fallback_symbols == ("TLT",)
    assert sleeves["defensive_sleeve"].symbols == ("TLT", "IEF")
    assert sleeves["defensive_sleeve"].total_weight == Decimal("0.30")
    assert plan.momentum_selections[0].symbols == ("QQQ", "VGT", "SOXX", "SCHG")


def test_codegen_aggregates_overlaps_and_emits_sleeve_contributions() -> None:
    source = generate_csharp(compile_strategy_to_lean_plan(portfolio_sleeves_strategy()))
    assert "RULETRADE_SLEEVE|" in source
    assert "sleeve=growth_sleeve" not in source  # stable id is emitted as a quoted value
    assert '"growth_sleeve"' in source and '"defensive_sleeve"' in source
    assert "targets0_0[symbol] + weight" in source
    assert ".Distinct().OrderBy(item => item)" in source


@pytest.mark.parametrize(
    ("closes", "expected_growth", "expected_final"),
    [
        (
            {"QQQ": [Decimal(100), Decimal(120)], "VGT": [Decimal(100), Decimal(110)], "SOXX": [Decimal(100), Decimal(90)], "SCHG": [Decimal(100), Decimal(80)]},
            (("QQQ", Decimal("0.5")), ("VGT", Decimal("0.5"))),
            (("IEF", Decimal("0.15")), ("QQQ", Decimal("0.35")), ("TLT", Decimal("0.15")), ("VGT", Decimal("0.35"))),
        ),
        (
            {"QQQ": [Decimal(100), Decimal(101)], "VGT": [Decimal(100), Decimal(90)], "SOXX": [Decimal(100), Decimal(80)], "SCHG": [Decimal(100), Decimal(70)]},
            (("TLT", Decimal(1)),),
            (("IEF", Decimal("0.15")), ("TLT", Decimal("0.85"))),
        ),
    ],
)
def test_reference_oracle_scales_and_aggregates_exact_decimals(closes, expected_growth, expected_final) -> None:
    result = evaluate_portfolio_sleeves(closes, lookback_bars=1)
    assert result.growth.final_targets == expected_growth
    assert result.final_targets == expected_final
    assert sum((weight for _, weight in result.final_targets), Decimal(0)) == Decimal(1)


def test_filter_fixture_has_all_subscription_assets_and_is_reproducible(tmp_path: Path) -> None:
    generated = tmp_path / "lean-filter-data"
    subprocess.run(
        [sys.executable, "scripts/generate_golden_lean_fixture.py", "--profile", "filter", "--output", str(generated)],
        check=True,
    )
    tracked = Path(__file__).parent / "fixtures" / "lean-filter-data"
    for family, suffix in (("daily", ".zip"), ("map_files", ".csv"), ("factor_files", ".csv")):
        directory = tracked / "equity" / "usa" / family
        assert {item.stem.upper() for item in directory.glob(f"*{suffix}")} == {"QQQ", "VGT", "SOXX", "SCHG", "TLT", "IEF"}
    tracked_files = {item.relative_to(tracked): item.read_bytes() for item in tracked.rglob("*") if item.is_file()}
    generated_files = {item.relative_to(generated): item.read_bytes() for item in generated.rglob("*") if item.is_file()}
    assert generated_files == tracked_files


def test_sleeves_e2e_verifier_compares_hierarchy_and_overlap() -> None:
    fixture = Path(__file__).parent / "fixtures" / "lean-filter-data"
    dates, closes = load_filter_fixture_closes(fixture)
    events = (
        "20240102", "20240201", "20240301", "20240401", "20240501", "20240603",
        "20240701", "20240801", "20240903", "20241001", "20241101", "20241202",
    )
    lines = ["Algorithm Id: test completed", "Failed data requests 0"]
    for event in events:
        index = dates.index(event)
        result = evaluate_portfolio_sleeves(
            {symbol: values[: index + 1] for symbol, values in closes.items()}
        )
        identity = f"{event[:4]}-{event[4:6]}-{event[6:]}"
        growth = result.growth
        scores = ",".join(f"{symbol}={value}" for symbol, value in growth.scores)
        lines.append(
            f"RULETRADE_FILTER|{identity}|threshold=0|eligible={','.join(growth.eligible)}"
            f"|rejected={','.join(growth.rejected)}"
        )
        lines.append(
            f"RULETRADE_MOMENTUM|{identity}|scores={scores}|ranked={','.join(growth.ranked)}"
            f"|candidate={','.join(growth.candidate)}|selected={','.join(growth.primary_selected)}"
            f"|decision={'insufficient' if growth.fallback_activated else 'executed'}"
        )
        lines.append(
            f"RULETRADE_FALLBACK|{identity}|component=fallback|asset=TLT"
            f"|decision={'activated' if growth.fallback_activated else 'not_activated'}"
        )
        lines.append(
            f"RULETRADE_FINAL|{identity}|selected={','.join(growth.final_selected)}"
            f"|decision=executed|source={'fallback' if growth.fallback_activated else 'primary'}"
        )
        for sleeve in result.sleeves:
            local = ",".join(f"{symbol}={weight}" for symbol, weight in sleeve.local_targets)
            scaled = ",".join(f"{symbol}={weight}" for symbol, weight in sleeve.scaled_targets)
            lines.append(
                f"RULETRADE_SLEEVE|{identity}|sleeve={sleeve.sleeve_id}"
                f"|local_selected={','.join(sorted(sleeve.local_selected))}"
                f"|local_weights={local}|allocation={sleeve.allocation}|scaled={scaled}"
            )
        weights = ",".join(f"{symbol}={weight}" for symbol, weight in result.final_targets)
        lines.append(
            f"RULETRADE_TARGETS|{identity}|selected={','.join(result.final_selected)}|weights={weights}"
        )
    result_payload = json.loads(
        (Path(__file__).parent / "fixtures" / "lean-results" / "strategy-equity-candlesticks.json").read_text()
    )
    log_text = "\n".join(lines)
    assert verify_sleeves_e2e(log_text, result_payload, fixture) == (12, 7, 5, 1)
    with pytest.raises(ValueError, match="aggregated targets mismatch"):
        verify_sleeves_e2e(
            log_text.replace("|weights=IEF=0.150,TLT=0.850", "|weights=IEF=0.150,TLT=0.840", 1),
            result_payload,
            fixture,
        )
