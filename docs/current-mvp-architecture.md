# Current MVP research-loop architecture

> **Status: SUPERSEDED.** Despite its historical title, this is not the current
> architecture. Use [the living architecture](architecture.md).

This document describes the merged product as of the Candidate adoption backend. It is an audit of the implemented system, not a future architecture proposal. Market Data v0 and the `Keep change` frontend are intentionally outside this change.

## Product resources

| Resource | Identity and mutability | Owner |
| --- | --- | --- |
| Strategy | Persistent mutable name/archive state and pointer to the current Revision | Strategy service and repository |
| Revision | Immutable validated Canonical snapshot and source hash | Strategy service and repository |
| Run | Persistent execution of one Revision or one Candidate with one BacktestConfig | Backtest Run service and repository |
| Decision Evidence | Immutable, ordered facts emitted with a successful Run | Backtest Run execution/persistence path |
| Candidate | Immutable backend-created semantic change based on an Original Revision and Run | Candidate service and repository |
| Candidate Run | Persistent Run tagged with `candidate_id`; executed through the same Run pipeline | Backtest Run service and repository |
| Comparison | Immutable backend alignment, changed contexts, and result deltas for Original/Candidate Runs | Comparison service and repository |
| Adoption | Idempotent append of the tested Candidate Canonical as the next immutable Revision | Candidate and Strategy services |

The resource chain is:

`Strategy → Revision → Run → Evidence → Candidate → Candidate Run → Comparison → Adoption`

Candidate creation never mutates the Original Canonical. Comparison never compiles, runs LEAN, or aligns evidence in the frontend. Adoption does not rerun LEAN or rewrite either historical Run.

## Frontend state ownership

| State | Owner | Boundary |
| --- | --- | --- |
| Strategy metadata and current Revision | API response held by `App`/`StrategyEditor` | Refetched from backend; never reconstructed from navigation state |
| Canonical working copy | `StrategyEditorProvider` reducer | The only mutable strategy source shared by Overview, Guided, and Flow |
| Guided/Flow selection, positions, viewport, open group | Editor-only reducer state | Never serialized into Canonical |
| BacktestConfig | `StrategyEditor` | Separate from Canonical |
| Persistent Run | Run route loader in `App` | Loaded by Run ID; route changes remount Result state |
| Transient result | `useBacktestRun` | Exists only for an unsaved working Canonical; has no Evidence/Candidate/Comparison affordance |
| Evidence and selected decision | `ResultWorkspace`/`DecisionAnalysis` | Loaded from the persistent Run and cleared when Run identity changes |
| Research context | `App` | Only Run ID, session ID, asset, and the local return route; backend records remain authoritative |
| Candidate submission | `WhatIfEditor` | One backend-supported filter-threshold intent; duplicate submission is disabled |
| Comparison and selected difference | `ComparisonWorkspace`, with navigation context retained by `App` | Comparison payload is reloaded by ID; selection is not treated as backend truth |

## Main user journey

1. Explore loads a backend-authored example. Creating a Strategy persists its first immutable Revision.
2. Overview, Guided, and Flow edit one Canonical working copy through semantic patches.
3. A clean saved Revision creates a persistent Run. An unsaved working copy uses the transient endpoint and produces only a temporary Result.
4. A persistent successful Result loads Decision Evidence. Selecting a session/asset can open the exact source field and return to the same research context.
5. `Try changing` sends only a backend-supported semantic intent. The backend creates a separate Candidate and executes its Candidate Run through the normal Run pipeline.
6. Comparison loads the persisted backend comparison and both persisted Runs. `Only differences` and `Why different?` render backend-owned changed contexts, including zero, Original-only, and Candidate-only differences.
7. Original Result, Candidate Result, source-rule navigation, browser Back/Forward, and direct Comparison reload use resource IDs and retained UI selection without copying backend resources into mutable navigation state.
8. The next frontend integration may expose `Keep change`; the adoption backend is already present.

## Backend/frontend responsibility boundary

The backend owns validation, Canonical materialization, compilation, LEAN execution, Run/Evidence persistence, Candidate construction, evidence alignment, Comparison persistence, adoption lineage, and stale-write detection. API routes translate HTTP and structured domain errors; services own domain rules; SQLite repositories own SQL.

The frontend owns authoring interactions, temporary form state, loading/empty/error presentation, and research navigation. It may send a semantic Candidate intent, but does not construct authoritative Candidate Canonical or align evidence streams. Backend error `code`/`message` fields and additional structured fields survive client parsing.

## Adoption frontend integration point

The minimal `Keep change` affordance fits in the Comparison header beside the existing Original/Candidate result navigation; no information-architecture change is required.

| Input/output | Source |
| --- | --- |
| `candidate_id` | `ComparisonRecord.candidate_id` |
| `expected_current_revision_id` | The Candidate base/Original Revision identity (`CandidateRecord.base_revision_id`, equal to the Original Run `revision_id`) after confirming the Strategy is still current |
| Request | `POST /api/v1/candidates/{candidate_id}/adopt` with `{ "expected_current_revision_id": "..." }` |
| Success | Existing `SaveRevisionResponse`: `{ created, strategy, revision }` |
| Stale | `409 stale_revision` includes `current_revision_id`; lineage mismatch is `409 candidate_adoption_lineage_mismatch` |
| Navigation | Open `/strategies/{strategy.id}` using the returned Strategy and allow its current Revision to load normally |

The frontend should disable duplicate submit while pending and treat idempotent `created: false` as success. It should not insert the returned Canonical into an already-open editor working copy.

## Final gap list

### Must fix before MVP

- None discovered by this integration audit beyond the fixes in this PR.

### Final integration remaining

- Add the `Keep change` frontend call and success/stale presentation at the existing Comparison action point.
- Complete Market Data v0 integration independently; this audit does not depend on or modify it.
- Run the final browser-level MVP acceptance journey against the deployed frontend/backend.

### Data/deployment blocked

- Real LEAN/data-cache acceptance and production data availability remain environment/deployment concerns.
- Authentication/workspace ownership is not represented in this single-user MVP resource model.

### Post-MVP

- Broader Candidate change kinds and strategy authoring breadth.
- Asynchronous job execution for long-running backtests.
- Feedback/annotation resources and richer cross-strategy discovery.
- Larger frontend architecture changes, generic experiment abstractions, and speculative performance work.
