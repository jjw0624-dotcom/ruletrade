# Repository engineering contract

## Artifact policy

| Classification | Repository examples | Policy |
| --- | --- | --- |
| `KEEP` | source, docs, lockfiles, scripts, workflow definitions | Track and review normally. |
| `GENERATED_BUT_INTENTIONALLY_TRACKED` | LEAN synthetic fixtures; momentum, sleeves, and cooldown frontend bootstrap fixtures | Track because tests and CI consume them; `make check` verifies frontend fixture drift. |
| `GENERATED_LOCAL — should be ignored` | `build/`, `frontend/dist/`, `.vite/`, TypeScript build info, caches, coverage | Generate as needed and ignore. |
| `LOCAL_RUNTIME_ARTIFACT — should be ignored` | `.acceptance/`, SQLite databases and sidecars, diagnostics | Never commit local state. |
| `DUPLICATE — consolidation candidate` | validation commands formerly embedded in workflow YAML | Consolidate into `Makefile` and `scripts/check*.sh`. |
| `STALE — evidence-backed deletion candidate` | the former root `TEST_REPORT.md` | Deleted: it reported an obsolete 11-test snapshot, was unreferenced, and contradicted current validation. |
| `UNKNOWN — do not delete` | experiments or fixtures without proven ownership/consumers | Retain until scripts, CI, docs, and history establish ownership. |

The LEAN data fixtures under `tests/fixtures/` and generated frontend fixtures imported by tests are
not ordinary build output. They are intentional, deterministic test inputs.

## One validation contract

| Command | Contract |
| --- | --- |
| `make bootstrap` | locked Python and npm dependency installation |
| `make check-fast` | Python tests, frontend tests, generated frontend fixtures, TypeScript |
| `make check` | fast checks plus frontend production build, Ruff, compileall, all shell scripts, whitespace, generated-fixture drift |
| `make check-lean-generate` | all maintained Canonical/compiler slices generate C# |
| `make check-lean` | generation plus compilation of every slice against the pinned LEAN Docker image |

CI has two responsibilities: `Repository validation` runs `make check`; `Generated C# / LEAN
compile` runs the LEAN contract. Repository validation caches uv dependencies and retains the
action-managed executable through successful post-job cache cleanup. The disk-heavy LEAN job
explicitly disables that cache, completes every uv operation first, and only then reclaims the
runner tool cache before pulling the large LEAN image.

## Toolchain and caches

- Python 3.12 is installed and managed by uv; CI verifies both `uv --version` and the uv-selected
  Python before dependency sync.
- Node 24 is declared by `.node-version` and `frontend/package.json`; CI verifies it before `npm ci`.
- Repository validation uses uv's dependency cache and setup-node's npm download cache. The LEAN
  job disables uv caching so it can safely reclaim the runner tool cache for the large Docker
  image. No cache includes SQLite databases, runtime state, or build results.
- LEAN compile output is uploaded for seven days only when that job fails.

## Local real-data acceptance

Acquiring licensed LEAN-format data is an operator responsibility. Setting
`RULETRADE_LEAN_DATA_DIR` only selects an existing cache. Inspect it first, then run the minimal and
full acceptance paths:

```bash
RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data" \
  ./scripts/inspect_market_data.sh QQQ SCHG SOXX VGT
RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data" \
  ./scripts/run_real_market_data_smoke.sh --symbol QQQ
RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data" \
  ./scripts/run_real_market_data_e2e.sh
```

The first two paths diagnose and smoke-test structurally valid local LEAN-format data. The full
acceptance intentionally remains strict about Security Master and history completeness.
