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

Not included yet:

- Strategy revisions and database storage
- Rules, Blocks, and editable Code authoring views
- Browser-triggered LEAN backtests
- Forward tests and competitions

See [Canonical Strategy v1 Foundation](docs/canonical-v1.md) for the current architecture boundary.

## Strategy Editor

Run the API and frontend in separate terminals:

```bash
uv run uvicorn ruletrade.api:app --reload
cd frontend && npm install && npm run dev
```

Open `http://127.0.0.1:5173`. The frontend loads the backend-owned Golden
Canonical strategy and Primitive Registry metadata from `/v1/editor/bootstrap`.
Guided and Flow hold no independent strategy document: both project the same
in-memory Canonical state and submit stable component-ID config operations to
it. Flow positions, viewport, selection, and active View remain editor-only
state and are never sent to Canonical validation.

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
