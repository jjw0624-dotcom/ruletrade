from __future__ import annotations

import shutil
import subprocess
from decimal import Decimal

import pytest

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean.codegen import _random_helper_source
from ruletrade.core.allocation import allocate_selected
from ruletrade.core.selection import select_symbols
from ruletrade.strategy.models import EqualWeightAllocation, RandomNSelection
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy
from ruletrade.strategy.v1.randomness import deterministic_random_seed


def _reference_targets(event_identity: str) -> tuple[list[str], dict[str, Decimal]]:
    strategy = golden_portfolio_strategy()
    plan = compile_strategy_to_lean_plan(strategy)
    selection = plan.random_selections[0]
    seed = deterministic_random_seed(
        strategy,
        selection.component_id,
        event_identity=event_identity,
    )
    selected = select_symbols(
        list(selection.symbols),
        RandomNSelection(count=selection.count, resample=selection.resample),
        seed=seed,
    )
    growth = allocate_selected(selected, EqualWeightAllocation())
    safe = allocate_selected(["TLT", "IEF"], EqualWeightAllocation())
    targets = {symbol: Decimal("0.70") * weight for symbol, weight in growth.items()}
    targets.update({symbol: Decimal("0.30") * weight for symbol, weight in safe.items()})
    return selected, targets


def test_golden_targets_use_v0_selection_and_allocation_oracle() -> None:
    first_selected, first_targets = _reference_targets("2024-01-02")
    same_selected, same_targets = _reference_targets("2024-01-02")
    selections = {_reference_targets(f"2024-{month:02d}-01")[0][0] for month in range(1, 7)}

    assert first_selected == same_selected
    assert first_targets == same_targets
    assert len(first_selected) == 2
    assert set(first_targets.values()) == {Decimal("0.35"), Decimal("0.15")}
    assert sum(first_targets.values(), Decimal("0")) == Decimal("1")
    assert len(selections) > 1


@pytest.mark.skipif(shutil.which("dotnet") is None, reason="dotnet SDK is not installed")
def test_emitted_csharp_random_helper_matches_python_v0_oracle(tmp_path) -> None:
    strategy = golden_portfolio_strategy()
    plan = compile_strategy_to_lean_plan(strategy)
    selection = plan.random_selections[0]
    event_identity = "2024-06-03"
    expected, _ = _reference_targets(event_identity)
    seed = deterministic_random_seed(
        strategy,
        selection.component_id,
        event_identity=event_identity,
    )
    symbols = ", ".join(f'"{item}"' for item in selection.symbols)
    program = f'''using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public static class Program
{{
    public static void Main()
    {{
        var seed = RuleTradeRandom.Seed(
            "{plan.strategy_identity}", "{selection.component_id}",
            "{{}}", "{event_identity}", true);
        Console.Write(seed + "|");
        Console.Write(string.Join(",", RuleTradeRandom.Sample(
            new[] {{ {symbols} }}, {selection.count}, seed)));
    }}
}}

{_random_helper_source()}
'''
    project = '''<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
'''
    (tmp_path / "Program.cs").write_text(program, encoding="utf-8")
    (tmp_path / "Parity.csproj").write_text(project, encoding="utf-8")

    completed = subprocess.run(
        ["dotnet", "run", "--project", str(tmp_path / "Parity.csproj"), "--configuration", "Release"],
        check=True,
        capture_output=True,
        text=True,
    )

    assert completed.stdout.strip() == f"{seed}|{','.join(expected)}"
