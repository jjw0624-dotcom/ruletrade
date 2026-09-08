# LEAN compiler v0

The compiler supports the Growth 70 / Safe 30 Golden strategy and the narrow
trailing-return Top N slice. Its backend path is:

`CanonicalStrategyV1 -> Strategy IR -> requirements analysis -> typed LeanPlan -> C# QCAlgorithm`

`CanonicalStrategyV1` is the authoritative Strategy Model. Strategy IR and LeanPlan are derived;
`codegen.py` accepts only a `LeanPlan` and inspects neither source models nor Strategy IR.
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
`lean backtest`. The repository also provides a one-command local E2E using the
tracked six-symbol synthetic fixture:

```bash
scripts/run_golden_lean_e2e.sh
```

The runner generates C#, calls `scripts/build_golden_lean_docker.sh`, copies
`tests/fixtures/lean-data` (including interest-rate data) into a temporary LEAN
container, launches the backtest, and calls the strict
`scripts/verify_lean_e2e.py` verifier. Output is written below
`build/lean/e2e/`. Set `RULETRADE_LEAN_IMAGE` to pin another LEAN image.

Python is selected in this order: the executable named by `RULETRADE_PYTHON`,
`uv run python`, then `python3`. A bare `python` executable is not required.

The committed synthetic equity archives are reproducibly generated with:

```bash
uv run python scripts/generate_golden_lean_fixture.py
```

They follow LEAN's US Equity Daily contract: one `<ticker>.csv` per ZIP, rows
formatted as `yyyyMMdd HH:mm,open,high,low,close,volume` in the data timezone,
integer prices in deci-cents, and bars only for actual 2023–2024 exchange trading days. The
pre-start 2023 bars support deterministic 126-bar warm-up while preserving the proven 2024 Golden
prices. Each map file begins before the data and ends with LEAN's `20501231`
sentinel; without that final row LEAN treats the symbol as delisted on the last
map date and never requests the 2024 price rows. Matching factor files use
unity factors and the same end-of-time sentinel.

The Docker build uses `tools/lean/RuleTrade.Generated.csproj`, the image's .NET
SDK, and:

- `/Lean/Launcher/bin/Debug/QuantConnect.Common.dll`
- `/Lean/Launcher/bin/Debug/QuantConnect.Algorithm.dll`
- `/Lean/Launcher/bin/Debug/Python.Runtime.dll`

`Python.Runtime.dll` is a transitive LEAN compile-time dependency; the generated
strategy does not execute Python.

The build and verifier remain independently callable when diagnosing a run:

```bash
scripts/build_golden_lean_docker.sh
PYTHONPATH=src uv run python scripts/verify_lean_e2e.py \
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
with LEAN's default 1% rate. The one-command runner copies it automatically to
remove the warning without adding a custom provider.

## Deliberate limits

- Classic `QCAlgorithm` only; no Algorithm Framework abstraction.
- Monthly first-trading-day intent with execution on the next complete Daily Slice.
- Named asset sets, RandomSelect, EqualWeight, MergeTargets, and Rebalance only.
- Trailing adjusted return, descending rank, and Top N with a fixed full-history policy.
- No general indicators, filters, stateful rules, composites, generic execution IR, or second backend.
- C# random selection contains only the CPython MT19937/sample behavior required
  to match the retained Python v0 selection oracle.
