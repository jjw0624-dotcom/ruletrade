# Backend observability and pipeline audit

This document records the implementation after Comparison v0. Diagnostics added
by this slice are operational metadata. They do not enter Canonical source,
source hashes, compiler inputs, Decision Evidence meaning, normalized results, or
investment decisions.

## Actual pipeline

```text
CanonicalStrategyV1
  -> source semantic validation
  -> compile_strategy_to_lean_plan
       -> source validation
       -> source-to-IR desugaring/normalization
       -> IR validation
       -> requirements analysis
       -> LEAN lowering to LeanPlan
  -> generate_csharp(LeanPlan, BacktestConfig settings)
  -> DockerLeanRunner
       -> compile generated C# against LEAN assemblies
       -> start LEAN with one selected synthetic data directory
       -> load LEAN result JSON
  -> normalized BacktestResult
  -> versioned machine-record Decision Evidence collection
  -> source-provenance validation
  -> atomic result + Evidence finalization of the persisted BacktestRun
```

The simplified diagram hides two intentional details. First, semantic validation
also occurs at the official compiler facade, so the early service check produces
a product-facing error before lowering while compiler callers remain safe.
Second, C# compilation, LEAN launch, and result loading are separate measured
stages inside one Docker runner rather than compiler passes.

A Revision Run loads immutable Canonical from its Revision. A Candidate applies
one typed semantic patch to a base Revision, validates and persists the resulting
immutable Canonical, then delegates to the same `BacktestRunService` execution
core. A Comparison loads an Original Run, Candidate, Candidate Run, their
Evidence v2 streams, and normalized results; it performs no compiler or runner
work.

## Measured diagnostics

Persisted Run timing now covers source load, validation, compiler/lowering,
codegen, C# compilation, LEAN execution, result loading, result normalization,
Evidence collection, Evidence provenance validation, finalization, and total.
The finalization measurement includes evidence-row insertion and preparation of
the terminal Run update; SQLite commit completion is outside that monotonic
sample. `total_ms` is at least the sum of reported non-overlapping stages.

Run cardinalities include Canonical bytes, generated-C# bytes, normalized-result
bytes, equity-point count, Evidence-event count, and Evidence bytes. Candidate
diagnostics separate context loading, evidence target validation, semantic patch,
resulting Canonical validation, persistence, creation overhead, total request,
and Candidate Canonical bytes. Candidate Run timings remain linked rather than
copied. Comparison diagnostics separate artifact loading, comparability
validation, Evidence loading, alignment/Behavior Diff, Result Diff, persistence,
total, and serialized Comparison bytes.

Integer monotonic milliseconds intentionally permit zero for sub-millisecond
work. Sizes use compact UTF-8 product JSON or generated UTF-8 C#. Operational
measurements can vary between executions and do not affect semantic identity.

Lifecycle logs carry IDs, counts, and durations only. They never include full
Canonical documents, generated C#, evidence streams, SQL, or raw engine output.

## Boundary inventory

| Boundary | Typed input | Typed output | Finding |
|---|---|---|---|
| Canonical to IR | `CanonicalStrategyV1` | `StrategyIR` | Explicit source IDs/provenance survive desugaring. |
| IR analysis | `StrategyIR` | backend-independent requirements | Subscriptions, history, schedules, calendars, semantic state, and retained runtime values remain distinct. |
| LEAN lowering | IR + requirements | `LeanPlan` | LEAN ownership begins here; backend APIs do not leak into source or IR. |
| Codegen | `LeanPlan` + run settings | C# text | Run dates/cash remain execution configuration, not strategy semantics. |
| LEAN result | result JSON | `BacktestResult` | A narrow normalization boundary owns supported product metrics. |
| LEAN evidence | versioned machine records | typed Decision Events | Human `RULETRADE_*` diagnostics are not product evidence inputs. |
| Revision to Candidate | Revision + typed field change | immutable Candidate Canonical | Existing validation and hashing are reused; no JSON-patch path exists. |
| Run evidence to Comparison | two Evidence v2 streams | typed changed contexts | Alignment uses semantic context, never human logs or global ordinal identity. |

The compiler facade remains the sole compilation route. Compatibility Backtest
API behavior delegates to the same `BacktestService`; Candidate execution
delegates to the same persisted Run core. Comparison has no execution path.

## Provenance continuity

Canonical component IDs become IR provenance, LeanPlan source references, and
machine Evidence `source_components`. Evidence v2 optionally carries the exact
Canonical `field_path`; Candidate validates that pair against the immutable base
Revision and persists it as explicit intent. Comparison uses that intent for
Strategy Diff and retains source-bearing original/candidate events for Behavior
Diff. Requirements retain provenance where a source component meaningfully
causes an execution need.

No current product step reconstructs component identity from variable names or
debug prose. Field paths remain deliberately optional where no unique editable
field owns a fact. That is healthy and should not be replaced with a generic
source-map framework.

## Persistence, services, and errors

Services own product rules: immutable Revision advancement, Run lifecycle,
Candidate patch policy, and Comparison comparability. SQLite repositories own
serialization, transactions, indexes, triggers, and safe storage exceptions.
FastAPI routes wire services and translate established domain errors; they do not
compile, patch, align, or issue SQL.

Schema v7 additively adds diagnostic JSON columns with `{}` defaults. Existing
rows therefore deserialize to honest zero/unknown measurements. Candidate and
Comparison semantic columns remain trigger-protected; only diagnostic metadata
may be updated. Run diagnostic data advances with its existing lifecycle.
Fresh creation and supported v1-v6 upgrades use the same initializer. Unknown
future versions still fail closed. No migration framework is justified yet.

Public errors continue to distinguish source/config validation, missing
resources, execution availability/failure, evidence failure, Candidate targeting,
Comparison incompatibility, and persistence failure. Raw SQLite exceptions,
Docker commands, paths, and unbounded logs remain server-side.

## Market-data flow

Canonical asset symbols feed backend-independent subscription/history
requirements. LEAN lowering emits subscriptions; `BacktestConfig.dataset_id`
selects exactly one mounted deterministic fixture directory. The current runner
supports `golden-synthetic`, `filter-synthetic`, and `cooldown-synthetic` only.
Expressing a symbol in Canonical does not imply that its historical data exists.
Missing fixture directories, missing history, inaccurate prices, or unsupported
dataset IDs fail execution rather than silently fabricating data.

These fixtures cover deterministic acceptance windows, not arbitrary tickers or
dates. The next data-infrastructure step should be driven by an MVP requirement
to test user-selected symbols: define a truthful dataset catalog and preflight
availability contract before adding providers or a generic market-data layer.

## Findings

### Healthy — keep as-is

- One Canonical/IR/LeanPlan/codegen/runner path serves Revision and Candidate Runs.
- Semantic state, runtime bookkeeping, Run configuration, evidence, and
  diagnostics have distinct ownership.
- Candidate and Comparison special cases remain localized to product services,
  one nullable Run source link, and their repositories.
- Comparison is deterministic work over immutable artifacts and never executes.

### Small cleanup completed

- Corrected Run `total_ms` so Evidence collection is included.
- Reused two tiny diagnostic helpers for monotonic elapsed time and compact JSON
  size instead of repeating subtly different calculations.
- Added lifecycle logs at Run, Candidate, and Comparison boundaries.

### Measured bottleneck candidates

No real LEAN runtime was available in Work, so none is claimed. CI compilation
proves generated C# compatibility but does not identify interactive latency.

As a contract sanity check, the deterministic SQLite Comparison fixture aligned
5 semantic records into 1 changed decision context, serialized to 5,873 bytes,
and completed in 10 ms in this Work environment with zero runner calls. This is
not a production benchmark and is not used to set a latency budget.

### Structural debt observed but not yet harmful

- The SQLite initializer contains additive creation and migration SQL in one
  module. Seven versions remain readable and tested; a migration framework is
  not yet warranted.
- `candidate_id` is a deliberate two-source Run special case. It is not broadly
  scattered and does not justify polymorphic execution-source infrastructure.
- Result and Evidence share one LEAN log/result artifact but have separate typed
  collectors, which is the correct truth boundary.

### Must address before MVP

- Run the real measurement command below on WSL/Docker before choosing a latency
  optimization.
- If arbitrary user tickers are required for MVP, introduce explicit dataset
  availability discovery/preflight; Canonical expressibility alone is not enough.

### Defer until after user testing

Generic observability, repositories, experiments, market-data providers,
compiler passes, event systems, and source polymorphism; distributed tracing;
statistical performance scoring; and database replacement.

## Measurement and budget policy

Do not set numerical budgets from fake runners or CI assembly compilation. Run:

```bash
uv run python scripts/measure_research_pipeline.py \
  --database build/pipeline-measurements.sqlite3
```

The command performs representative Golden, Fallback, Independent Schedules,
Cooldown, Candidate, and Comparison work through real Docker/LEAN and prints a
compact stage/cardinality breakdown. Use a fresh database path for each sample.

Collect at least three runs per case before setting budgets. Separate fixed C#/
LEAN startup cost from changes correlated with strategy complexity, asset count,
date range, Evidence event count/bytes, and equity-point count. The next backend
optimization should target the dominant repeatable real-runtime stage, not the
largest number observed once.

## Self-review

- A persisted Run now shows all reliably separable stages and artifact growth.
- Candidate creation overhead is separate from its linked Run; Comparison has its
  own execution-free diagnostic summary.
- Diagnostics are non-semantic and do not affect source hashes or decisions.
- No duplicate compiler/execution/evidence path was introduced or found.
- Candidate/Comparison special cases remain localized and service/repository/API
  ownership remains clear.
- Provenance supports Result to Rule to Candidate to Compare without heuristics.
- The only concrete duplication removed was elapsed/size measurement logic; a
  tempting generic lifecycle/telemetry framework was intentionally rejected.
- Investment behavior, Canonical, IR, requirements, LeanPlan, and generated C#
  semantics are unchanged.

Classification: no known Must-fix architecture finding; instrumentation is good
enough for MVP measurement; runtime bottleneck decisions require real WSL/LEAN;
generic consolidation remains intentionally deferred.
