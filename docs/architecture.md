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
| Supported Strategy edits | Backend authoring capabilities/apply service | Only after Save | Buttons, forms, and contextual actions |
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

Structure, Summary, Guide, and Flow consume one derived semantic Strategy
projection of the working Canonical. That projection follows typed Canonical
connections and preserves each authored `component_id` and optional
`field_path`; it is a read model, not another Strategy document. Supported
product shapes degrade explicitly when their relationships are ambiguous
instead of choosing the first matching primitive. Switching views does not
create a Revision or reinitialize the Strategy. The shared Inspector sends
typed intent through the backend authoring contract; a successful validated
Canonical response replaces the working copy and all representations reproject.

xyflow owns canvas rendering, edges, dragging, selection mechanics, viewport,
zoom, pan, and fit. RuleTrade owns the Canonical-to-conceptual projection,
semantic identity, Inspector linkage, Evidence linkage, and every mutation back
to Canonical. Moving a visual node is UI state and never dirties Canonical.

Activity answers “what saved research exists?” and navigates persisted Runs.
Research answers “what am I investigating?” and displays Result, Decision,
Why/Why-not, Candidate, and Comparison. Research is attached to the Builder; it
is not a Strategy representation and does not own another Strategy model.

### Editable representations v1

Summary describes the whole Strategy; Guide explains it step by step; Flow uses
xyflow for capital/ownership paths; Blocky uses Blockly for decision order;
Rules states supported semantics in human language; Code shows precise
Canonical components and connections; AI exports portable context and accepts
one reviewed semantic proposal. Code is read-oriented until a restricted parser
can be justified. AI is a handoff surface, not an embedded model or authority.

Each view projects the same working Canonical through a perspective-specific
read model. Shared `SemanticSelection` carries Canonical `component_id`, optional
`field_path`, role and group context. Editor block IDs, graph node IDs, sentence
positions and text offsets are presentation details. Field edits and supported
construction go through the existing backend capabilities/apply contract; only
the validated Canonical response replaces working Strategy state. Rejection
does not dirty the Strategy. Switching representations preserves working
Canonical, Revision context and Research; viewport and layout remain UI-local.
No universal future UI AST or editor serialization is Strategy truth. See
[the representation boundary and operation matrix](editable-representations-v1.md).

The [connected workspace contract](connected-workspace-contract-v1.md) records
CURRENT state ownership, the Canonical semantic address, shared mutation and
query/command boundaries, and the seam from persisted Research to the current
representation. Its Validate/Forward integration notes are FUTURE / DIRECTIONAL,
not implemented Strategy modes.

## Authoring today

Supported authoring is backend-owned. The frontend sends current Canonical to
`POST /v1/canonical/strategies/authoring/capabilities` and exposes only the
returned operations. Applying an operation through
`POST /v1/canonical/strategies/authoring/apply` returns a fully validated
Canonical that replaces the working copy. Rejection leaves the previous working
Canonical and dirty state unchanged.

Implemented structural operations include group rename, add/remove one
supported qualification, transformation to Choose assets, add/remove fallback,
add/remove Cooldown for eligible Top N pipelines, and an explicit Growth/Defensive split transformation. The caller supplies
required allocation and defensive-asset intent; the backend does not guess it.
Typed operations also own asset-universe membership, return lookback,
qualification threshold, selection count and resampling, two-sleeve allocation,
schedule cadence, fallback choice, and the duration of an existing Cooldown.
Capabilities carry exact eligible targets, current values, choices, and useful
constraints. Registry and domain validation remain authoritative; the frontend
owns wording and temporary form state, not semantic eligibility.

Arbitrary primitive CRUD, free edge wiring, generic Group CRUD, unrestricted
multiple conditions, and arbitrary Cooldown placement are not supported. See the
[current authoring contract](authoring.md).

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

Feedback Navigation projects persisted Decision summaries into narrow Result
events carrying exact Run and Decision IDs. Lightweight Charts owns equity
rendering, crosshair, zoom and pan; RuleTrade owns event categories, selection,
Evidence and semantic navigation. Dense Daily Results use bounded overview
markers and a complete paged list. Selecting one event fetches only its persisted
session details, then `component_id + optional field_path` enters the currently
active Strategy representation. See [Feedback Navigation v1](feedback-navigation-v1.md).

Decision-time Evidence remains distinct from subsequent outcomes. The current
Result does not label decisions as mistakes or compute per-asset hindsight
returns from unavailable data. Quick Result explains what happened and why;
robustness and parameter variation remain future Validation work.

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

Current MVP 1 scope is deliberately narrow: supported backend-owned Strategy
shapes; one Canonical; editable Guide, Flow, Blocky, and Rules perspectives;
read-oriented Summary and Code; external AI handoff v0; real LEAN execution;
persisted Decision Evidence; dense Result-event navigation; one typed Candidate
change family; behavioral and outcome Comparison; Activity recovery; and
stale-safe Return/Keep. See [the connected research loop](connected-research-loop-v1.md).

Deferred work includes arbitrary wiring, generic Group CRUD, unrestricted
nested groups or boolean-expression authoring, editable arbitrary Code,
embedded AI, multi-operation AI transactions, optimization, sensitivity,
robustness, Holdout, Validation, Forward testing, production Replay, provider
frameworks, automatic market-data acquisition, broker execution,
authentication/multi-user support, and Community features.

See the [documentation index](README.md) for current subsystem documents and
clearly labeled historical records.
