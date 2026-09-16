# Market Data v0: local LEAN US equity daily research

> **Status: CURRENT subsystem and operator contract.**

## Scope and architecture

Market Data v0 supports US-listed equities and ETFs, daily trade bars, and historical
backtests through the existing LEAN backend. Options, futures, FX, crypto, intraday,
fundamentals, alternative data, live feeds, and brokerage integration are out of scope.

The actual execution path is:

```text
Canonical symbols
  -> official compiler requirement analysis
  -> BacktestConfig.dataset_id
  -> market-data preflight
  -> configured LEAN data directory
  -> unchanged compiler / generated AddEquity subscriptions
  -> Docker LEAN
  -> normalized result and Decision Evidence
  -> persisted BacktestRun
```

These remain separate facts:

- A symbol can be expressed and validated in Canonical source.
- Compiler analysis derives the daily subscriptions and history lookback required.
- Preflight determines whether the configured source contains usable data.
- Acquisition is an operator action governed by provider access and licensing.

The synthetic dataset IDs remain deterministic test fixtures. The additional
`us-equity-daily-local` ID means a local, LEAN-formatted, US-equity daily data directory
configured by `RULETRADE_LEAN_DATA_DIR`. It does not mean arbitrary symbols are available.

## Requirement and preflight contract

`POST /v1/revisions/{revision_id}/market-data/preflight` accepts a normal immutable
`BacktestConfig`. It returns the requested date range, adjusted-price assumption, and a
per-symbol result. A real-data symbol is available only when:

- its daily ZIP is readable and contains data in the requested interval;
- its total coverage reaches the requested end;
- the required number of completed observations exists before the visible start; and
- LEAN map and factor files exist.

The pre-start count comes from existing compiler history requirements (for example, a
126-bar trailing-return operation requires 126 completed pre-start observations). It is
not inferred from UI state. LEAN remains authoritative for exchange-calendar execution;
the cache check counts actual stored sessions and never silently shortens a lookback.

Statuses distinguish provider unavailable, no price data, missing Security Master data,
insufficient history, requested-period coverage failure, and corrupt cache. Execution
repeats preflight before starting Docker and fails with `market_data_unavailable` instead
of launching LEAN with known-missing data.

## Provider decision and acquisition

The v0 execution source is a caller-supplied, structurally valid local LEAN data directory.
Run provenance identifies it conservatively as `lean-local-data`; RuleTrade cannot infer
who produced or licensed files from their path or format. The QuantConnect US Equity
dataset acquired through the authenticated LEAN CLI is one supported operator acquisition
path. It is already in LEAN's native format and supplies the US Equity Security Master
needed for splits, dividends, and symbol changes.

QuantConnect documents that local CLI access requires a paid organization, the Security
Master is a prerequisite, and daily per-ticker downloads cost credits. Acquisition is an
explicit operator action. See the official [LEAN CLI US Equity dataset
documentation](https://www.quantconnect.com/docs/v2/lean-cli/datasets/quantconnect/us-equity)
and [corporate-actions documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions):

```bash
lean data download --dataset "US Equity Security Master"
lean data download --dataset "US Equities" --data-type "Trade" \
  --ticker "SPY" --resolution "Daily" --start "20220101" --end "20241231"
```

Repeat the second command for every required symbol, including enough pre-start history,
then configure the workspace data directory:

```bash
export RULETRADE_LEAN_DATA_DIR=/absolute/path/to/lean-workspace/data
```

RuleTrade deliberately does not invoke a paid download automatically. Downloads may consume
credits, require provider authentication, and are subject to the customer's license. The
preflight response truthfully reports that server acquisition is unsupported and directs
operators to the authenticated CLI. Credentials never enter Canonical source, API payloads,
generated C#, or persisted Runs.

Free/public adjusted-price APIs were considered and rejected for v0: their reliability,
redistribution terms, delisting coverage, and corporate-action fidelity are weaker or
ambiguous, and converting already-adjusted bars risks changing LEAN semantics.

Provider terms govern local use, server-side product use, caching, and redistribution. This
repository makes no grant to redistribute provider data. Deployment beyond licensed local
research needs review against the applicable provider agreement.

## Adjustment and reproducibility

Generated algorithms remain unchanged and use `DataNormalizationMode.Adjusted`. The chosen
path supplies raw LEAN daily trade bars plus map/factor files; LEAN applies its adjustment
factors. RuleTrade does not pre-adjust bars, avoiding double adjustment.

A persisted Run records immutable source/config identity and the known provider/source kind,
`adjusted` normalization, requested symbols, and observed local coverage. It does not claim
an immutable provider snapshot or dataset version because the local CLI source does not
expose one to RuleTrade. Results and evidence reopen without rerunning LEAN, but exact
execution reproduction also requires retaining the licensed local files used at run time.

## Cache, Candidates, and failures

The configured LEAN directory is the cache. Preflight is read-only and idempotent. Docker
bind-mounts it read-only instead of copying or downloading it per Run. A filter-threshold
Candidate inherits the Original Run configuration and unchanged requirements, so it gets a
warm cache hit and performs no acquisition.

Preflight catches missing/corrupt files, incomplete coverage, insufficient warm-up, and
absent map/factor files. Provider outages and rate limits belong to the separate CLI step.
Data that passes file preflight can still be rejected by LEAN; that remains a safe persisted
execution failure.

Coverage is file-level. v0 has no security-master search, delisted-ticker discovery,
licensed server acquisition, or provider snapshot ID. These are the concrete limits that
prevent a promise of arbitrary US-equity/ETF execution.

## Operator workflow and local completeness

Setting `RULETRADE_LEAN_DATA_DIR` only locates existing files. It does not acquire them.
The operator workflow is:

1. Obtain appropriately licensed LEAN-compatible US Equity daily bars and Security Master
   files.
2. Set `RULETRADE_LEAN_DATA_DIR` to that directory.
3. Inspect the required symbols before starting Docker:

   ```bash
   ./scripts/inspect_market_data.sh QQQ SCHG SOXX VGT
   ```

4. Run the one-symbol smoke acceptance using a symbol that reports `available`.
5. Run the full Candidate/Comparison acceptance only when its complete universe reports
   `available`.

The diagnostic reports daily ZIP, map-file, factor-file, coverage, and the production
availability reason. It calls the same `MarketDataService` cache inspection used by
preflight rather than maintaining shell-specific availability rules.

Manual WSL testing found the following structurally observed local state. This is
acceptance evidence about one developer cache, not a provider or licensing claim:

| Symbol | Daily ZIP | Map | Factor | Result |
| --- | --- | --- | --- | --- |
| QQQ | yes | yes | yes | structurally complete; coverage is reported by the diagnostic |
| SCHG | yes | no | no | `security_master_missing` |
| SOXX | yes | no | no | `security_master_missing` |
| VGT | yes | no | no | `security_master_missing` |
| SPY, IWM, AAPL, GOOG, GOOGL, EEM | no | yes | yes | `no_data` |

A nonexistent configured root reports `provider_unavailable` for every requested symbol.
Daily ZIP presence without both Security Master files remains unavailable. These negative
paths are successful acceptance outcomes and are not weakened to make a Run start.

## Real WSL/Docker acceptance

The minimal smoke defaults to QQQ, a 21-observation trailing-return lookback, and the final
63 stored sessions. It selects the period from the ZIP itself only after confirming at
least 84 observations, so the start always has 21 real pre-start observations. Explicit
dates may be supplied together when a stable locally retained interval is preferred:

```bash
export RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data"
./scripts/run_real_market_data_smoke.sh --symbol QQQ
```

The smoke persists and reopens one normal BacktestRun and verifies a normalized result and
Decision Evidence. It does not create a synthetic Candidate merely to broaden acceptance.

After `QQQ`, `SCHG`, `SOXX`, `VGT`, and Security Master files are present:

```bash
export RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data"
./scripts/run_real_market_data_e2e.sh
```

The script runs an Original real-data Run, filter-threshold Candidate Run, Decision Evidence
v2 persistence, and Comparison. Both Runs use the same read-only cache. It intentionally
continues to fail before LEAN when SCHG, SOXX, or VGT lacks map/factor files.

Both acceptance programs use a unique temporary database by default, so a failed attempt
does not poison the next run. Supplying an explicit database path remains supported; that
caller-owned path must be fresh and is never removed or overwritten by the scripts.

## Architecture review

Healthy and retained: Canonical expressibility, compiler requirements, immutable Revision /
Candidate / Run / Evidence / Comparison ownership, one compiler and LEAN pipeline, and
synthetic fixtures. Small changes: an official requirement-analysis facade, typed preflight,
read-only data mount, structured diagnostics, and persisted known provenance.

Must fix before merge: none known after focused verification. Provider/deployment blocked:
automatic acquisition and redistribution require credentials, paid access, and license
review. Deferred intentionally: provider plugins, security-master search, cloud cache,
intraday/non-equity assets, immutable dataset snapshots, and broad market-data APIs.
