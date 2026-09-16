# RuleTrade living architecture

**Status: CURRENT.** This is the authoritative living architecture for the
implemented repository. Update it when system ownership or end-to-end behavior
changes. Historical slice documents do not override it.

## Product loop

```text
Entry
  → working Canonical
  → validate and save immutable Revision
  → BacktestRun + BacktestConfig
  → compiler → Strategy IR → LeanPlan → generated C#
  → Docker LEAN
  → normalized Result + Decision Evidence
  → Research
  → Candidate + Candidate Run
  → Comparison
  → Keep/adoption or Discard
  → current Revision
```

Canonical is the authored and persisted Strategy source. The compiler and
execution pipeline are one-way: derived representations and runtime artifacts
never reconstruct or become the authored Strategy.

## Sources of truth

| Concept | Authority | Persisted? | Derived/non-authoritative counterparts |
| --- | --- | --- | --- |
| Strategy semantics | `CanonicalStrategyV1` | In immutable Revision | Summary, Guide, Flow, IR, C#, xyflow nodes |
| Primitive vocabulary | Primitive Registry | Code-defined and serialized through schema/bootstrap | Inspector controls and labels |
| Source validity | Canonical validator using Registry and semantic checks | No | Frontend advisory validation |
| Structural edits | Backend authoring capabilities/apply service | Only after Save | Buttons and contextual actions |
| Compiler-normalized meaning | Strategy IR | Reproducible, not primary storage | LeanPlan and C# |
| LEAN execution plan | LeanPlan | Reproducible, not authored | Generated C# |
| Execution mechanics | QuantConnect LEAN | Result captured by Run | Docker process and assemblies |
| Saved Strategy version | Revision | Yes, immutable | Mutable browser working copy |
| One execution | BacktestRun | Yes | Loading and progress UI |
| Decision facts | Decision Evidence | Yes with successful saved Run | Why/Why-not presentation |
| Research hypothesis | Candidate | Yes, immutable | What-if editor values |
| Original/Candidate diff | Comparison | Yes, immutable | Comparison selection/filter UI |
| Builder semantic state | Working Canonical + base Revision | Canonical only on Save | Representation and panels |
| Selected Strategy object | `SemanticSelection` | No | Focus and selected visuals |
| Saved-research navigation | Activity | No additional persistence | Drawer open state |
| Active investigation | Research destination + `ResearchContext` | References persisted artifacts | Open/width/UI state |

## Strategy model and compiler

`CanonicalStrategyV1` combines named definitions, stable component identities,
typed components and connections, entrypoints, and deterministic randomness.
The Primitive Registry describes ports, fields, definition references,
authoring metadata, and compiler implementation identities. Compiler algorithms
remain backend code rather than Registry templates.

The semantic path is:

```text
Canonical
  → Registry-backed source validation
  → desugaring and normalization
  → Strategy IR validation
  → requirements analysis
  → LEAN lowering
  → LeanPlan
  → C# generation
  → Docker LEAN
```

RuleTrade owns investment meaning, validation, lowering, normalized results, and
product provenance. LEAN owns commodity execution mechanics: subscriptions,
scheduling, holdings, orders, and backtest execution.

IR, LeanPlan, generated source, assemblies, traces, Results, Evidence, and
xyflow nodes are derived. None is an editable Strategy representation.

## Persistence and execution

A Strategy is a long-lived user-facing identity. Saving a changed working copy
validates Canonical, inserts an immutable child Revision, and advances the
Strategy's current Revision using an expected-parent stale-write check. An
identical save is idempotent.

A persistent Test belongs to exactly one saved Revision and stores its complete
`BacktestConfig`. The synchronous BacktestRun lifecycle is
`pending → running → succeeded|failed`. Successful Runs persist normalized
Results, provenance, timings, and Decision Evidence. Unsaved working copies use
the explicit transient LEAN compatibility path and do not pretend to represent
the saved Revision.

Market-data preflight derives requirements from official compiler analysis. For
the real local dataset it verifies requested coverage, pre-start history, and
required LEAN Security Master files. Availability is not inferred by the
frontend and is not Strategy state.

## Strategy Builder

The workbench has one Strategy state and multiple representations:

```text
StrategyWorkspace
├── Strategy / Revision / working Canonical state
├── Structure and contextual construction
├── shared SemanticSelection
├── shared SemanticInspector
├── Summary
├── Guide
├── Flow using xyflow
├── Activity navigator
└── Research workspace
```

Summary, Guide, and Flow reproject the same working Canonical. Switching views
does not create a Revision or reinitialize the Strategy. Selection uses stable
`component_id`, optional `field_path`, and semantic context rather than
display text. The shared Inspector edits the selected semantic object.

xyflow owns canvas rendering, edges, dragging, selection mechanics, viewport,
zoom, pan, and fit. RuleTrade owns the Canonical-to-conceptual projection,
semantic identity, Inspector linkage, Evidence linkage, and every mutation back
to Canonical. Moving a visual node is UI state and never dirties Canonical.

Activity answers “what saved research exists?” and navigates persisted Runs.
Research answers “what am I investigating?” and displays Result, Decision,
Why/Why-not, Candidate, and Comparison. Research is attached to the Builder; it
is not a Strategy representation and does not own another Strategy model.

## Authoring today

Structural authoring is backend-owned. The frontend sends current Canonical to
`POST /v1/canonical/strategies/authoring/capabilities` and exposes only the
returned operations. Applying an operation through
`POST /v1/canonical/strategies/authoring/apply` returns a fully validated
Canonical that replaces the working copy.

Implemented structural operations include group rename, add/remove one
supported qualification, transformation to Choose assets, add/remove fallback,
and an explicit Growth/Defensive split transformation. The caller supplies
required allocation and defensive-asset intent; the backend does not guess it.
Arbitrary primitive CRUD, free edge wiring, generic Group CRUD, and unrestricted
multiple conditions are not supported.

Existing field, asset-set, schedule, and allocation edits still use typed local
frontend semantic patches. The Registry informs those controls and backend
Canonical validation remains authoritative before persistence and execution.
This local/backend duplication is known architectural debt. A future headless
authoring contract may consolidate it, but it is not implemented today.

## Evidence and experiments

Decision Evidence is objective execution truth owned by one immutable Run. Its
source references form the identity path:

```text
Canonical component
  ↕ component_id + optional field_path
Decision Evidence
```

Result → View rule resolves provenance into shared `SemanticSelection`.
Rule → Show where this mattered searches persisted successful, non-Candidate
Runs for the exact Revision and exact provenance, then opens the existing
Research context. It reuses persisted Evidence and does not execute LEAN.

Candidate v0 applies one backend-validated filter-threshold change to an
immutable base Revision and runs the resulting immutable Candidate through the
ordinary execution path. It does not advance the Strategy. Comparison verifies
the immutable Original/Candidate lineage, source hashes, complete configuration,
successful Results, and Evidence before producing Strategy, Behavior, and
Result differences. Comparison itself never executes LEAN.

Keep/adoption accepts a Candidate through the Strategy service with the
expected current Revision. Stale or lineage-mismatched adoption fails without
overwriting current work. Successful or already-created adoption makes the
intended Revision current. Discard is navigation only and mutates nothing.

## Compatibility boundaries

The repository retains:

- the original YAML/simple-strategy/`bt` CLI and API vertical slice;
- transient Canonical LEAN execution for unsaved working copies;
- standalone Run and Comparison routes for direct links and compatibility.

They are not competing authorities for the persisted Canonical product.

## Current scope and deferred work

Current scope is deliberately narrow: supported backend-owned Strategy shapes,
one Canonical, real LEAN execution, persisted Evidence, one typed Candidate
change family, immutable Comparison, and Keep/Discard.

Deferred work includes arbitrary wiring, generic Group CRUD, unrestricted
nested groups or boolean-expression authoring, Blocky, Rules, editable Code,
AI, optimization, sensitivity, robustness, Holdout, Forward testing,
production Replay, provider frameworks, automatic market-data acquisition,
broker execution, authentication/multi-user support, and Community features.

See the [documentation index](README.md) for current subsystem documents and
clearly labeled historical records.
