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
whose event identity is the scheduled ISO date (`yyyy-MM-dd`), selected growth
tickers, and target weights.

## Daily data execution timing

LEAN invokes Scheduled Events before it updates `Security` prices and before
`OnData` for a timeslice. An intraday scheduled trade backed only by Daily
subscriptions can therefore have no price on the first trading day and stale
prices thereafter.

For this Daily-only compiler slice, `LeanMonthlyEvent.execution` is explicitly
a `LeanOnDataExecution`. The generated scheduled callback records the event
identity but does not trade. The next `OnData(Slice)` executes the pending
rebalance only when the Slice contains a Daily bar, `Security.HasData` is true,
and `Security.Price` is positive for every required subscription. This uses
LEAN's scheduler and data lifecycle; RuleTrade does not implement a clock or
scheduler. Keeping the scheduled identity separate from execution time also
preserves deterministic `per_event` RandomSelect results.

## Docker compile and strict E2E verification

The normal supported route remains an official LEAN CLI project and
`lean backtest`. For a local synthetic-data harness using the same assemblies
as `quantconnect/lean:latest`, generate and compile the DLL with:

```bash
scripts/build_golden_lean_docker.sh
```

This uses `tools/lean/RuleTrade.Generated.csproj`, the image's .NET SDK, and:

- `/Lean/Launcher/bin/Debug/QuantConnect.Common.dll`
- `/Lean/Launcher/bin/Debug/QuantConnect.Algorithm.dll`
- `/Lean/Launcher/bin/Debug/Python.Runtime.dll`

`Python.Runtime.dll` is a transitive LEAN compile-time dependency; the generated
strategy does not execute Python. Pass `build/lean/bin/RuleTradeGenerated.dll`
to the existing LEAN Launcher configuration and mount the synthetic LEAN data
directory containing QQQ, VGT, SOXX, SCHG, TLT, and IEF.

After the Launcher finishes, validate both its log and result JSON:

```bash
PYTHONPATH=src python scripts/verify_lean_e2e.py \
  --log build/lean/lean.log \
  --result build/lean/results/backtest-result.json
```

The verifier rejects fatal/runtime/price-readiness errors and incomplete runs.
It requires 12 monthly records, exactly two growth assets, 35/35/15/15 weights,
a 100% total, positive Total Orders, and exact monthly agreement with the
retained Python v0 RandomSelect oracle.

### Synthetic interest-rate data

`InterestRateProvider.FromCsvFile(): no interest rates were loaded` comes from
missing LEAN risk-free-rate reference data, not the Golden Strategy's target or
order semantics. It can affect risk-adjusted statistics, so the repository
provides `tests/fixtures/lean-data/alternative/interest-rate/usa/interest-rate.csv`
with LEAN's default 1% rate. Copy that path into the corresponding location in
the synthetic data directory to remove the warning without adding a custom
provider.

## Deliberate limits

- Classic `QCAlgorithm` only; no Algorithm Framework abstraction.
- Monthly first-trading-day intent with execution on the next complete Daily Slice.
- Named asset sets, RandomSelect, EqualWeight, MergeTargets, and Rebalance only.
- No indicators, stateful rules, composites, generic execution IR, or second backend.
- C# random selection contains only the CPython MT19937/sample behavior required
  to match the retained Python v0 selection oracle.
