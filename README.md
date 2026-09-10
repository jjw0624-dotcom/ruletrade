# RuleTrade MVP

This repository is the first vertical slice of RuleTrade:

`Simple strategy YAML -> validated semantic hash -> bt compilation -> backtest -> normalized JSON -> FastAPI`

It also contains the engine-independent Strategy Core v0 and the Canonical Strategy v1 foundation.
Canonical v1 combines a typed component graph with expression/action ASTs so future Guided, Rules,
Flow, Blocks, and Code editors can operate on one semantic document.

## Scope

Included:

- Simple strategy schema with fixed weights
- Initial capital
- Optional monthly contribution
- Initial and monthly rebalancing
- CSV dataset registry
- `bt` backend adapter
- TWR, CAGR, MDD, Sharpe, XIRR, net contribution, and investment profit
- CLI and FastAPI
- Deterministic synthetic dataset
- Unit tests and an optional `bt` integration test
- Strategy Core v0 with deterministic group selection, allocation, runtime intents, and traces
- LEAN execution adapter and runtime bridge for the v0 subset
- Canonical Strategy v1 types, Primitive Registry, graph/AST models, semantic validation, and hashing
- Typed LEAN compiler v0 with Golden Strategy C# generation and local Docker E2E tooling
- A React Strategy Editor where Guided and Flow project and patch one Canonical v1 document
- Durable Strategy identities with immutable Canonical Revision history in SQLite
- Durable BacktestRun history for saved Revisions, normalized results, provenance, and timings
- Durable, versioned Structured Decision Evidence for persisted Runs
- Immutable filter-threshold Candidates executed as real Candidate Runs
- Immutable Original-versus-Candidate Comparisons with Strategy, Behavior, and Result diffs
- Persisted pipeline timing and artifact-size diagnostics for Runs, Candidates, and Comparisons

Not included yet:

- User accounts, sharing, and natural-language decision explanation
- Rules, Blocks, and editable Code authoring views
- Browser-triggered LEAN backtests
- Forward tests and competitions

See [Canonical Strategy v1 Foundation](docs/canonical-v1.md) for the source-model boundary and
[Compiler Foundation](docs/compiler-foundation.md) for the consolidated compiler and evidence
boundaries proven through Cooldown, and
[Strategy and immutable Revision persistence](docs/strategy-revision-persistence.md) for the first
durable product-domain boundary, and
[Persistent BacktestRun](docs/backtest-run-persistence.md) for immutable execution configuration,
historical results, provenance, and latency instrumentation, and
[Structured Decision Evidence](docs/decision-evidence.md) for the machine contract, immutable event
schema, source provenance, and Timeline/Inspector read API, plus the
[Evidence v1.1 gap fill](docs/decision-evidence-v1-1.md) for explicit cardinality, signal, stopping
stage, and Canonical field identity, and
[Candidate Change v0](docs/candidate-change.md) for the first evidence-backed research hypothesis
and real Candidate Run, and
[Comparison v0](docs/comparisons.md) for deterministic Strategy, Behavior, and Result diffs over
immutable Original and Candidate Runs, and the
[backend observability audit](docs/backend-observability-audit.md) for measured pipeline boundaries,
market-data constraints, and the real-LEAN measurement command.

## Strategy Editor

Run the API and frontend in separate terminals:

```bash
uv run uvicorn ruletrade.api:app --reload
cd frontend && npm install && npm run dev
```

Open `http://127.0.0.1:5173`. The frontend loads the backend-owned Daily Top-1 strategy with an
explicit 20-completed-trading-session cooldown
Canonical strategy and Primitive Registry metadata from `/v1/editor/bootstrap`.
Guided and Flow hold no independent strategy document: both project the same
in-memory Canonical state and submit stable component-ID config operations to
it. Flow positions, viewport, selection, and active View remain editor-only
state and are never sent to Canonical validation. Frontend test commands export
their Golden and Momentum inputs from the same backend bootstrap function; there is no second
hand-maintained frontend strategy fixture.

Run the real Cooldown differential acceptance path locally with Docker:

```bash
./scripts/run_cooldown_lean_e2e.sh
```

The **Backtest** action submits that exact current Canonical document to the
backend LEAN compiler path and presents normalized metrics plus a lightweight
SVG equity curve. Run dates, initial cash, and the synthetic dataset selection
remain separate from strategy semantics. See
[Editor-to-LEAN backtest](docs/editor-lean-backtest.md) for the API/service
boundary and local acceptance commands.

## Exact cash-flow semantics

- Initial capital is available at the first dataset date.
- Initial target weights are applied on the first dataset date.
- A recurring contribution starts on the first trading date of the next calendar month.
- The contribution and target-weight rebalance happen in the same `bt` step.
- Fractional shares are enabled by default.

## Run with Docker

```bash
unzip ruletrade-mvp.zip
cd ruletrade-mvp
docker compose up --build
```

Open:

- API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health

Run the full smoke test inside the container:

```bash
docker compose run --rm api ./scripts/smoke_test.sh
```

## Run without Docker

Python 3.11-3.13 is supported.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[bt,dev]"
./scripts/smoke_test.sh
```

## CLI

```bash
ruletrade validate examples/monthly_dca.yaml
ruletrade backtest examples/monthly_dca.yaml --dataset synthetic_prices --data-dir data
```

## API request

```bash
curl -sS http://127.0.0.1:8000/v1/backtests/run \
  -H 'content-type: application/json' \
  -d '{
    "strategy": {
      "name": "monthly-dca-qqq-voo",
      "currency": "USD",
      "initial_capital": "10000",
      "recurring_contribution": {"amount": "500", "frequency": "monthly"},
      "rebalance": "monthly",
      "assets": [
        {"symbol": "QQQ", "weight": "0.40"},
        {"symbol": "VOO", "weight": "0.60"}
      ]
    },
    "dataset_id": "synthetic_prices",
    "config": {
      "commission_bps": "0",
      "allow_fractional_shares": true
    }
  }'
```

## Why `bt`

The MVP delegates portfolio accounting, target weights, rebalancing, transactions, and flow-adjusted performance to `bt`. RuleTrade owns the input contract, semantics, compilation, normalized metrics, and product layer.

## Next successful slice

After this smoke test passes, add one conditional rule end to end:

`QQQ 60-session drawdown <= -10% -> use 70/30 weights for the next contribution, with a 20-session cooldown.`

## Diagnostic bundle to share

After installation, run:

```bash
./scripts/doctor.sh
```

It creates `ruletrade-diagnostic.txt`. Review it, then share that text file. It contains environment versions and test output, not credentials.
