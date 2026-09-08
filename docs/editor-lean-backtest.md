# Editor-to-LEAN backtest

The Strategy Editor submits its current in-memory `CanonicalStrategyV1` directly
to `POST /v1/backtests/lean`. Guided and Flow do not construct an execution
document. Run settings are a separate `BacktestConfig` and are not included in
the strategy hash.

The backend path is:

`HTTP -> BacktestService -> semantic validation -> lower_to_lean_plan -> generate_csharp -> DockerLeanRunner -> normalize_lean_result`

The endpoint is synchronous for this MVP. Docker is checked only when a run is
requested, so the API can start and unit tests can use a fake runner without a
LEAN installation.

## Local use

Start the API and frontend, then click **Backtest**:

```bash
uv run uvicorn ruletrade.api:app --reload
cd frontend && npm install && npm run dev
```

The existing strict Golden compiler acceptance command remains available:

```bash
./scripts/run_golden_lean_e2e.sh
```

To exercise the application service with an edited Golden strategy (`count=3`):

```bash
PYTHONPATH=src uv run python scripts/run_editor_lean_e2e.py --random-count 3
```

Both commands require a working Docker daemon and `quantconnect/lean:latest`
(or `RULETRADE_LEAN_IMAGE`). The tracked synthetic dataset is selected by the
only v1 dataset identifier, `golden-synthetic`.

The Docker build runs as the invoking Linux user and keeps MSBuild intermediate
files inside the disposable container. This prevents root-owned `obj` files in
`build/lean/runs` and lets the runner remove every temporary run directory on
success or failure. LEAN is launched with the explicit algorithm ID
`RuleTradeGeneratedAlgorithm`; its full result is selected by LEAN's
`{AlgorithmId}.json` naming contract. Summary, order-event, nested
`{AlgorithmId}/alpha-results.json`, config, and other JSON artifacts are not
treated as backtest results.

## Error contract

Errors use `detail.code` so the browser can distinguish semantic invalidity,
valid-but-unsupported compiler input, runtime unavailability, execution
failure, and malformed LEAN output. Raw process logs and tracebacks are not part
of the product API.
