# Persistent BacktestRun, provenance, and timing contract

This slice adds a durable execution identity above immutable Strategy Revisions. It does not add a
queue, caching, Decision Evidence, Candidates, or Comparisons.

## Domain and lifecycle

- A Strategy is long-lived user-facing identity.
- A Revision is immutable strategy semantics.
- A BacktestRun is one execution of exactly one Revision under one immutable `BacktestConfig`.
- Persistent Runs require a saved Revision. The existing `/v1/backtests/lean` endpoint remains an
  explicit transient path for an unsaved editor working copy.

The synchronous resource endpoint persists real transitions at transaction boundaries:

```text
pending -> running -> succeeded
                   -> failed
```

The pending row is committed before execution, running is committed before invoking LEAN, and the
terminal result is committed afterward. A process crash can therefore leave an honest pending or
running record; recovery of interrupted Runs is deferred. Terminal Runs cannot transition again.

Two requests for the same Revision and configuration create two Run IDs. Execution identity is not
a cache key.

## SQLite schema version 2

Schema version 2 adds `backtest_runs` to the existing database:

| Field | Meaning |
| --- | --- |
| `id` | independent Run UUID |
| `revision_id` | foreign key to one immutable Revision |
| `status` | pending, running, succeeded, or failed |
| `config_json` | complete validated immutable `BacktestConfig` |
| `result_json` | normalized product result for succeeded Runs only |
| `error_json` | bounded public failure for failed Runs only |
| `provenance_json` | known source/build/backend/dataset identity |
| `timings_json` | non-negative measured wall-clock stage durations |
| timestamps | created, started, and completed lifecycle times |

Database checks enforce payload/status consistency. Triggers prevent input/provenance mutation,
invalid lifecycle transitions, and deletion. Existing version-1 databases migrate automatically;
unknown versions still fail safely. Strategy archival does not delete Revisions or Runs.

Schema version 3 adds immutable Structured Decision Events without changing BacktestRun inputs or
results; see `decision-evidence.md`. Runs created under version 2 remain readable historical results.

## Provenance

Each Run stores facts available at execution time:

- Revision ID, source hash, and Strategy schema version;
- RuleTrade application version;
- optional `RULETRADE_BUILD_COMMIT`, only when deployment supplies it;
- backend ID `lean` and configured engine image reference when the runner exposes it;
- dataset ID from the immutable Run configuration;
- dataset version as null because current synthetic fixtures have no independent version contract.

The repository has no separate compiler semantic version, resolved container digest, or dataset
version today, so none is invented. Seeded randomness remains inside the immutable Canonical source
and its source hash rather than being duplicated as one misleading Run-level seed.

Possible future cache inputs are source hash, exact Run config, dataset/version, build/compiler
identity, resolved engine version, and seeds. No cache behavior exists in this slice.

## Results and failures

Successful Runs store only the normalized product result: start/end value, total return, order count,
fees, and equity curve. Reading the Run reconstructs the Result Workspace without invoking LEAN.
Raw result packets, generated C#, assemblies, LeanPlan, IR, and trace strings remain derived/debug
artifacts and are not persisted.

Failed Runs store no result and retain only a public code/message. Runtime unavailability and
unsupported source remain distinct. Compiler, Docker, generated-path, raw log, and SQLite details
are not stored in the product record.

## Timings

Timers use monotonic wall-clock nanoseconds and persist integer milliseconds. Zero is valid for
sub-millisecond stages. Measured boundaries are source load, semantic validation, compiler/lowering,
C# generation, generated-C# compilation, LEAN container execution/result copy, result-file load,
normalization, and total request execution. The runner does not claim finer subprocess precision.
Timings are diagnostic metadata, not strategy semantics and not currently shown prominently.

No real LEAN timing sample was available in the Work environment because Docker was unavailable,
so this PR does not claim which stage dominates. The first real local/hosted Run will answer that
from persisted evidence.

## API and frontend workflow

| Method and route | Contract |
| --- | --- |
| `POST /v1/revisions/{revision_id}/backtest-runs` | create and synchronously execute one Run |
| `GET /v1/revisions/{revision_id}/backtest-runs` | list historical Runs for a Revision |
| `GET /v1/backtest-runs/{run_id}` | reopen one complete historical Run |
| `POST /v1/backtests/lean` | transient unsaved-source compatibility execution |

The next frontend slice can require Save, POST the current Revision, render the returned terminal
Run, later list it, and reopen it by Run ID. The current editor remains compatible by using the
transient endpoint; it creates no persistent Run and makes that distinction explicit in code.

## Architecture review

1. Every persistent Run has exactly one Revision foreign key.
2. Frozen models and database triggers separate immutable config from strategy semantics.
3. A successful result reopens entirely from SQLite without LEAN.
4. Failed Runs have an honest terminal status, safe error, and no result.
5. `BacktestService.execute` remains the one compiler/LEAN execution core.
6. The compatibility endpoint delegates through `BacktestRunService.execute_transient`.
7. Unknown build, engine digest, and dataset version values remain null.
8. Compiler/application, backend/engine image, and dataset identities are separate fields.
9. Timing values are diagnostic metadata only.
10. Future Decision Events can use the stable Run ID as their parent foreign key.
11. Original and Candidate executions can remain ordinary Runs and be related by a future layer.
12. No Experiment or cache semantics were added.
13. Archive preserves the Revision and all historical Runs.
14. The largest real latency source is intentionally not asserted until a real instrumented Run.

There are no known must-fix findings. Synchronous HTTP execution and interrupted-Run recovery are
good enough/deferred respectively for this vertical slice. Queueing, engine digest capture, dataset
versioning, Decision Evidence, Candidate relationships, Comparison, and the Runs UI are intentionally
deferred.
