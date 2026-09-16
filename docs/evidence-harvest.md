# Evidence Harvest — Rule to Result

> **Status: CURRENT subsystem contract.** This is the implemented reverse
> provenance path inside the integrated Research workbench.

## Infrastructure audit

| Need | Existing RuleTrade contract | Decision |
| --- | --- | --- |
| Persisted execution context | Immutable `BacktestRun` references a Revision and retains configuration/result provenance | REUSE EXISTING |
| Historical semantic evidence | Immutable Decision Events are persisted transactionally with successful Runs | REUSE EXISTING |
| Rule identity | `source_components.component_id` plus optional `field_path` points back to Canonical provenance | REUSE EXISTING |
| Lightweight discovery | `GET /v1/backtest-runs/{run_id}/decision-events` returns summaries including session and source provenance | REUSE EXISTING |
| Exact historical detail | `GET /v1/backtest-runs/{run_id}/decision-events/{event_id}` returns the existing typed Evidence object | REUSE EXISTING |
| Research destination | `ResearchContext { runId, sessionId, asset }` already restores the Result timeline and existing Decision Inspector | REUSE EXISTING |
| Reverse navigation | Result → View rule already carries Revision, component, field and research context | REUSE EXISTING |

No endpoint, persistence schema, index, Evidence representation, query language, or execution path is added. StrategyEditor already loads the persisted Runs belonging to the Strategy. Evidence Harvest considers successful non-Candidate Runs for the exact Revision, lists their immutable summaries, matches authoritative component/field provenance, and fetches detail only for matching events so existing asset derivation can provide an exact Research destination.

## Interaction

`selected rule → Show where this mattered → saved decision date/assets → existing Result/Research Layer → exact Decision Inspector`

When navigation originated at Result → View rule, the originating Revision and preferred asset remain attached to that exact selected provenance. Selecting a different rule falls back to the current Revision and does not reuse stale historical focus.

An empty result states that no saved decisions use the rule yet. API failure is distinct from an empty history. Loading the history performs only existing Evidence GET requests; it never creates a Run or invokes LEAN.

## Scope classification

| Work | Classification |
| --- | --- |
| Existing Runs, Evidence APIs, typed Evidence, provenance, ResearchContext, Result workspace and Inspector | REUSE EXISTING |
| Exact reverse-provenance matching and compact contextual history presentation | SMALL NEW SEMANTIC |
| Rule activity count | REUSE EXISTING — the number of returned persisted contexts is available without aggregation infrastructure |
| Asset-specific destinations | REUSE EXISTING — derived from the matching typed Evidence by the existing `relevantAssets` function |
| Evidence-kind filters | DEFER — unnecessary for the narrow loop |
| Cross-Revision semantic history | DEFER — current lookup stays honest to the selected Revision |
| Interesting-decision ranking, Replay-lite, aggregation framework and generic Evidence query | DEFER |
| xyflow, charting-library, ECharts or accessibility-library migration | DEFER — no new commodity interaction mechanics are required |

## Acceptance boundary

Backend integration coverage creates a real persisted Run/Evidence transaction from the established LEAN-output collector fixture, reads summaries/details through FastAPI, and asserts those reads do not call the runner again. Frontend integration coverage proves exact component and field matching, exclusion of unrelated Revision/Candidate/failed contexts, exact run/session/asset construction, empty presentation, and preservation of the source provenance used by Result → Rule.
