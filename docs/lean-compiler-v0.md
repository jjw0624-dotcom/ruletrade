# LEAN compiler v0

The v0 compiler intentionally supports one Canonical Strategy v1 shape: the
Growth 70 / Safe 30 golden strategy. Its backend path is:

`CanonicalStrategyV1 -> dependency analysis -> typed LeanPlan -> C# QCAlgorithm`

`codegen.py` accepts only a `LeanPlan`; it does not inspect Canonical models.
The emitted code uses LEAN subscriptions, scheduling, portfolio holdings, and
order APIs instead of recreating them in RuleTrade.

## Generate and run

Generate the C# source:

```bash
uv run python scripts/generate_golden_lean.py
```

The default output is `build/lean/Main.cs`. To run it with an existing LEAN CLI
C# project, replace that project's `Main.cs` with this file, ensure its
`config.json` names `RuleTradeGeneratedAlgorithm`, and run:

```bash
lean backtest "<project-directory>"
```

The generated algorithm defaults to 2024-01-01 through 2024-12-31 with
$100,000 cash. These run settings are `CSharpGenerationSettings`, not Canonical
strategy semantics. Each monthly run emits a `RULETRADE_TARGETS` debug record
whose event identity is the ISO date (`yyyy-MM-dd`), selected growth tickers,
and target weights.

## Deliberate limits

- Classic `QCAlgorithm` only; no Algorithm Framework abstraction.
- Monthly first-trading-day execution only.
- Named asset sets, RandomSelect, EqualWeight, MergeTargets, and Rebalance only.
- No indicators, stateful rules, composites, generic execution IR, or second backend.
- C# random selection contains only the CPython MT19937/sample behavior required
  to match the retained Python v0 selection oracle.
