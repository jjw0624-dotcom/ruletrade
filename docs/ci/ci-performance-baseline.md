# CI performance baseline

Baseline repository state: `f2b387d84a086c809c57a861b585c7d8123df6b9` (PR #81 integration). Measurements come from GitHub Actions REST run, job, and step timestamps; they are not estimates from YAML.

## Sample

The machine-readable baseline records the ten most recent completed Capability CI runs available during the audit. Seven successful runs are used for duration medians. Three cancelled superseded runs remain in the JSON because they demonstrate that `cancel-in-progress` works and that cancellation is surfaced by the required aggregator.

| Metric | Observed |
|---|---:|
| Successful samples | 7 |
| Median workflow wall time | 947 s (15m 47s) |
| Range | 816–1,075 s |
| Ordinary initial runner queue | 2–13 s |
| Temporal matrix median queue | 482 s |

## Job baseline

| Job | Median execution | Range | Median queue | Unique purpose |
|---|---:|---:|---:|---|
| Static & Contract | 27 s | 25–38 s | 3 s | schema, lock, type, build, generated artifacts |
| Unit & Semantic | 65 s | 47–70 s | 3 s | complete Python and frontend unit suites |
| Perspective Consistency | 25 s | 18–28 s | 3 s | duplicated subset of Unit & Semantic |
| Real Browser E2E | 30 s | 24–38 s | 3 s | real Chrome interaction and screenshots |
| Production API Contract | 404 s | 22–530 s | 3 s | persisted V2 Docker API proof; older sample lacked it |
| LEAN Compilation | 489 s | 448–545 s | 3 s | generated C# compilation against LEAN |
| Docker core-selection | 500 s | 483–633 s | 3 s | DailyValue, semantic corpus, static Program |
| Docker score-composable | 477 s | 404–598 s | 3 s | weighted Score and composable restart |
| Docker temporal-replay | 456 s | 399–470 s | **482 s** | temporal/state/replay/multi-clock |
| Capability CI Required | 3 s | 2–4 s | 3 s | stable required-check aggregation |

The temporal job's queue is workflow-imposed rather than runner scarcity: the matrix used `max-parallel: 2`, while the third profile started approximately one Docker-profile duration later. Other jobs in the same runs normally queued for only a few seconds.

## Step evidence

Across successful samples:

- `Free space for LEAN image`: 28 observations, median 82 s.
- persisted-API free-space step: 6 observations, median 125 s.
- `make check-lean-daily-values`: median 426 s.
- `make check-lean-weighted-score`: median 357 s.
- `make check-lean-temporal-stateful`: median 360 s.
- generated C# compile: median 376 s.
- persisted V2 Docker API execution: median 288 s.

The free-space step includes `docker system prune --all --force`. This audit does not remove it without a disk-capacity experiment because doing so could turn a timing optimization into an intermittent correctness failure.

## Duplication found

1. Perspective Consistency invokes Python and Vitest files already included by the complete Unit & Semantic suites.
2. Production API Contract reruns four Python files already owned by the complete Python suite before performing its unique Docker-backed persisted-run proof.
3. Every PR runs LEAN, all three Docker profiles, persisted API, and real Chrome even for documentation-only changes.
4. `max-parallel: 2` serializes the third Docker profile and determines the critical path.
5. LEAN jobs disabled the safe uv dependency cache even though `uv.lock` is immutable within a run.

Full per-run, per-job, and per-step timestamps are in `ci-performance-baseline.json`.
