# Development and validation

**Status: CURRENT.** This is the authoritative contributor setup and validation
guide. Repository commands are owned by the Makefile and scripts; this document
describes rather than reimplements them.

## Toolchain

- Python 3.12, installed and selected through `uv`
- Node 24, declared by `.node-version` and `frontend/package.json`
- Python dependencies locked by `uv.lock`
- frontend dependencies installed from `frontend/package-lock.json` using `npm ci`
- Docker for LEAN compilation and runtime acceptance

## Clean setup

```bash
uv python install 3.12
make bootstrap
```

`make bootstrap` runs locked Python dependency synchronization and `npm ci`.
Do not replace the locked install with an unrecorded dependency upgrade.

## Run the product

In separate terminals:

```bash
make api
make frontend
```

Open `http://127.0.0.1:5173`. FastAPI documentation is available at
`http://127.0.0.1:8000/docs`.

## Validation contract

| Command | Contract |
| --- | --- |
| `make check-fast` | Python tests, generated frontend fixtures, frontend tests, TypeScript |
| `make check` | Fast checks plus production frontend build, maintained Ruff scope, compileall, recursive shell syntax, whitespace, and generated-fixture drift |
| `make check-lean-generate` | Generate C# for every maintained Canonical/compiler slice |
| `make check-lean` | Generate and compile every maintained slice against Docker LEAN |

`make check-lean-generate` proves generation, not compilation or runtime.
`make check-lean` proves C# compilation against the configured LEAN image; it
does not by itself prove a real browser journey or real-market-data execution.

## GitHub Actions

`.github/workflows/ci.yml` runs for pushes and pull requests targeting `main`.
It has two responsibilities:

- **Repository validation** installs Python 3.12 and Node 24, performs locked
  dependency installation, and runs `make check`.
- **Generated C# / LEAN compile** generates maintained algorithms and compiles
  them against Docker LEAN. Diagnostics are uploaded only on failure.

CI uses repository-owned Make/script entry points. It does not cache SQLite
state, runtime databases, or build results. See
[Repository engineering](repository-engineering.md) for artifact policy and
cache details.

## Codespaces

The devcontainer installs Python 3.12, Node 24, and uv, runs `make bootstrap`,
and forwards ports 8000 and 5173. Start the services with the normal Make
commands and run `make check-fast` or `make check`.

The minimal Codespace deliberately does not enable Docker-in-Docker. Use GitHub
Actions for generated-C#/LEAN compilation and WSL or another local Docker host
for full runtime/browser acceptance.

## Local Docker and LEAN

Compile every maintained generated algorithm:

```bash
make check-lean
```

Representative synthetic runtime scripts remain under
`scripts/run_*_lean_e2e.sh`. They require a working Docker daemon and the
configured LEAN image.

## Real local market data

The server does not acquire or purchase data. `RULETRADE_LEAN_DATA_DIR`
selects an existing operator-provisioned LEAN-format cache. Inspect completeness
before running acceptance:

```bash
export RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data"
./scripts/inspect_market_data.sh QQQ SCHG SOXX VGT
./scripts/run_real_market_data_smoke.sh --symbol QQQ
./scripts/run_real_market_data_e2e.sh
```

Replace the exported value if the cache is elsewhere. The diagnostic and smoke
prove local structure/execution, not the data's origin or licensing. The full
acceptance intentionally fails before LEAN when required history or Security
Master data is incomplete.

## WSL browser acceptance

With the backend, frontend, Docker, and required data available, exercise the
real product rather than mocked UI behavior:

```text
Explore → persisted Strategy → Guide/Flow edit → Save → Test
→ Result/Decision/Why → View rule → Show where this mattered
→ Try Change → Candidate Run → Comparison → Keep/Discard → Test again
```

Browser acceptance is distinct from static C# compilation. Do not claim real
LEAN runtime acceptance unless the Docker execution actually ran.

## Local artifacts

Build output, `.acceptance/`, Vite caches, SQLite databases, coverage, and
local diagnostics are ignored. LEAN synthetic fixtures and generated frontend
bootstrap fixtures are intentionally tracked because CI consumes and verifies
them.
