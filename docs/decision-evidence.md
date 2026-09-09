# Structured Decision Evidence v1

Decision Evidence is immutable execution truth owned by one persisted `BacktestRun`. It is not an
explanation, an event-sourcing system, or another strategy representation. `CanonicalStrategyV1`
remains authoritative; evidence is a regenerable run artifact whose historical copy is retained so a
result can be inspected without rerunning LEAN.

## Audited execution evidence

| Existing trace | What it proves | Evidence kind / phase |
| --- | --- | --- |
| `RULETRADE_SIGNAL` / `MOMENTUM` | observations, deterministic rank, signal candidates, primary selection | `selection` / `selection` |
| `RULETRADE_FILTER` | every observed asset's strict threshold pass or rejection | `filter` / `evaluation` |
| `RULETRADE_FALLBACK` / `FINAL` | activation and primary-versus-fallback final selection | `fallback`, `final_selection` / `selection` |
| `RULETRADE_REFRESH` | sleeve-local targets committed to a retained snapshot | `snapshot_refresh` / `snapshot_commit` |
| `RULETRADE_PORTFOLIO_EVENT` | portfolio event and exact retained snapshot timestamps used | `snapshot_usage` / `portfolio_execution` |
| `RULETRADE_SLEEVE` | local targets × allocation = scaled contribution | `sleeve_contribution` / `portfolio_execution` |
| `RULETRADE_COOLDOWN` | signal candidate, last exit, elapsed/required sessions, eligibility | `cooldown` / `selection` |
| `RULETRADE_STATE` | user-semantic `last_exit` mutation and target-exit cause | `state_mutation` / `state_mutation` |
| `RULETRADE_TARGETS` | aggregated targets submitted by the RuleTrade rebalance | `final_targets` / `portfolio_execution` |

The old traces remain diagnostic and strict E2E evidence. They are not parsed into product records.
Generated C# emits a separate `RULETRADE_EVIDENCE_V1` percent-encoded key/value record at the
decision point. The collector accepts only that explicit contract and validates contiguous runtime
sequence, types, filter partitions, and the v1 vocabulary before persistence.

## Schema and identity

One machine record becomes one Decision Event. This intentionally keeps same-session actions distinct.

- Identity is `(run_id, event-NNNNNN)`; IDs are stable and unique within their Run.
- `ordinal` is the emitted sequence and defines total ordering, including actions on the same session.
- `session_id` is the exchange-session date already used by the compiled event.
- `phase` distinguishes evaluation, selection, snapshot commit, state mutation, and portfolio execution.
- `source_components` contains typed role/component-ID pairs such as `filter`, `rank`, `selection`,
  `fallback`, `cooldown`, `sleeve`, `schedule`, and `rebalance`.
- `evidence` is a discriminated typed payload; there is no generic arbitrary JSON event.
- `schema_version=1` versions this derived artifact independently of Canonical and SQLite schemas.

Numeric runtime observations and weights are persisted as exact decimal strings through Pydantic JSON.
No presentation rounding occurs. Existing narrow cross-runtime score tolerance remains confined to
the independent E2E comparison; semantic IDs, decisions, ranks, selections, and target algebra remain
exact.

## Why / Why-not coverage

Filter evidence contains an evaluation for every asset with the observed value and `passed`, including
rejected assets. Selection separately records scores, rank, candidates, and primary-selected assets.
Fallback and final selection are separate facts. Cooldown records a signal candidate even when blocked,
including `last_exit`, elapsed completed exchange sessions, required sessions, and eligibility. This
lets presentation later identify the condition where an asset stopped without fabricating prose.

State mutation exposes only the source-visible `last_exit` value and the `target_exit` cause. Generated
prior-target dictionaries and trading-session counters are not evidence fields. Retained snapshots are
runtime bookkeeping, but their committed values and use timestamps are recorded as temporal execution
facts so independent-schedule behavior is reconstructable.

Sleeve evidence retains local targets, allocation, and scaled targets. The final-target fact retains the
aggregated executed target map. A client can therefore reconstruct, for example, local `TLT=1` × sleeve
`0.70` = contribution `0.70`, followed by cross-sleeve aggregation.

## Run lifecycle and storage

SQLite schema v3 adds `decision_events` with one typed JSON payload per ordered row. It does not repeat
the Canonical source, result, logs, IR, LeanPlan, or generated C#. Update/delete triggers make evidence
immutable. New Runs become `succeeded` only in the same transaction that inserts their complete event
set and result. Collection failure produces `failed/evidence_collection_failure`; storage failure is
rolled back and produces `failed/evidence_persistence_failure`; both have no partial evidence. Execution
failures likewise have no Decision Evidence in v1. Runs created under schema v2 remain truthful legacy
results with an empty evidence list rather than fabricated evidence.

The deterministic cross-semantic contract fixture contains 10 events and 1,911 emitted machine-record
bytes (about 191 bytes/event). The Golden persistence fixture contains 2 events and 409 bytes (about
205 bytes/event). Neither duplicates Canonical source. These are sanity measurements, not a storage
optimization target; actual LEAN fixture measurements can be repeated during Docker acceptance.

## Read API and frontend boundary

- `GET /v1/backtest-runs/{run_id}/decision-events` returns ordered lightweight summaries.
- `GET /v1/backtest-runs/{run_id}/decision-events/{event_id}` returns one typed detail.

The next frontend can add `Analysis → Decision Timeline → Decision Inspector` and show evaluated assets,
pass/fail facts, candidates, primary/final selections, fallback, cooldown, snapshot provenance, sleeve
math, final targets, and source components. It never needs to parse `RULETRADE_*` debug text. Prose
explanation, `/why`, Candidate Changes, comparisons, annotations, and counterfactuals are intentionally
deferred.

## Manual and real-LEAN acceptance

After starting the API and creating a persisted Strategy/Revision as documented in
`strategy-revision-persistence.md`, run:

```bash
curl -sS -X POST http://localhost:8000/v1/revisions/$REVISION_ID/backtest-runs \
  -H 'content-type: application/json' \
  -d '{"config":{"start_date":"2024-01-02","end_date":"2024-12-31","initial_cash":"100000","dataset_id":"filter-synthetic"}}'

curl -sS http://localhost:8000/v1/backtest-runs/$RUN_ID/decision-events
curl -sS http://localhost:8000/v1/backtest-runs/$RUN_ID/decision-events/$EVENT_ID
```

Real LEAN acceptance remains the existing independent-oracle scripts; each representative verifier now
also checks Structured Decision Evidence against its oracle:

```bash
./scripts/run_filter_lean_e2e.sh
./scripts/run_fallback_lean_e2e.sh
./scripts/run_sleeves_lean_e2e.sh
./scripts/run_independent_schedules_lean_e2e.sh
./scripts/run_cooldown_lean_e2e.sh
./scripts/run_momentum_lean_e2e.sh
./scripts/run_golden_lean_e2e.sh
```
