# MVP frontend capability and API gap report

This report records frontend-driven product requirements discovered while building the production MVP application foundation. It does not propose backend architecture or introduce contracts.

## Current capability inventory

### A. Supported by real backend contracts

- `GET /v1/editor/bootstrap?example=...` returns a backend-owned Canonical Strategy, Primitive Registry metadata, and semantic validation result for `golden`, `momentum`, `filter`, `fallback`, `sleeves`, `independent_schedules`, and `cooldown`.
- `POST /v1/canonical/strategies/validate` validates the current Canonical payload.
- Existing semantic patches atomically edit supported component fields in the one in-memory Canonical Strategy shared by Guided and Flow.
- `POST /v1/backtests/lean` accepts the exact Canonical Strategy plus a separate `BacktestConfig` containing start date, end date, initial cash, and an internal dataset ID.
- The normalized response contains strategy hash, engine, echoed config, initial/final value, total return, order count, total fees, and equity curve.
- Structured errors distinguish invalid strategy, unsupported strategy, unavailable runtime, execution failure, and malformed result.

### B. Frontend navigation or layout boundaries

- Explore can present a curated subset of real backend examples and load their authoritative bootstrap payloads.
- Strategies can exist as an honest empty product surface until persistence is available.
- Strategy Workspace can separate semantic editing from run configuration.
- Result Workspace can reserve a downstream Analysis region without presenting invented evidence.

### C. Requires a future backend/domain contract

- Saved Strategy persistence and ownership.
- Immutable Revision identity and history.
- Persistent, reopenable Backtest Runs.
- Structured Decision Trace and Why/Why not evidence.
- Candidate Changes and application as a new Revision.
- Original/Candidate experiments and comparison.
- Feedback annotations.

## Concrete product requirements

### My Strategies

The frontend needs list/create/read/update/archive semantics scoped to the current user or workspace. List items need stable Strategy ID, current Revision summary, name, description, and updated timestamp. The API must distinguish a saved Strategy resource from the Canonical source payload for one Revision.

### Preserve and reopen edits

The frontend needs immutable Revision identity tied to the exact Canonical source payload and semantic hash. Creating a Revision must not overwrite the source used by an earlier run. A concurrency/version guard is needed when updating a Strategy's current Revision.

### Reopen historical results

The frontend needs persistent Backtest Run identity linking exact Revision, BacktestConfig, dataset identity/version, compiler/backend versions, status, timestamps, warnings, and normalized result. Running must become an asynchronous status resource when execution can outlive a request.

### Decision explanations

The Result Workspace needs structured evidence aligned to a run event: event/data timestamp, source component IDs, signal observations, eligibility and rejection reasons, filter/rank/selection results, fallback activation, sleeve-local targets, scaled contributions, merged targets, holdings before/after, and linked orders. Evidence must preserve the market-data cutoff needed to explain why a value was available at that event.

### Quick Candidate Change

The frontend needs a safe operation tied to a Revision's stable component ID and Registry field. The backend must validate the candidate Canonical payload and create a distinct candidate Revision or ephemeral candidate identity without changing Original.

### Compare

The frontend needs two comparable persistent runs, compatibility status, aligned decision events, and server-defined decision/holding/order diffs. Performance deltas alone are insufficient. The comparison must trace condition difference to decision, holdings, orders, and result differences.

### Feedback

Annotations need stable references to Strategy, Revision, Run, event timestamp, instrument, and optionally decision/order evidence. Feedback must remain user intent, not silently mutate strategy semantics.

## Largest blocker

Immutable Strategy/Revision persistence is the largest blocker. Without it, edits exist only for the current session, a run cannot reliably be reopened against its exact source, and Candidate/Compare cannot preserve a trustworthy Original. Structured Decision Trace is the next blocker for the Understand portion of the loop.
