# Semantic engine and existing Builder final integration

## Verified baseline

This work started from `main` at merge commit
`7951a1c4c5b43c6deb5e4f1552fbb72ab3812bac`. That commit merges the
composable semantic execution head
`bb88cbe49da9c7b9e0f593c710ac50986b171368` (PR #56). The merged tree contains
the weighted Score/Allocation, temporal Event/State/Memory, weekly-to-daily,
independent sleeve, checkpoint/restart, reference fixtures, generated C# and
Docker differential paths introduced by that work.

## Generality audit

The execution engine is compositional inside its declared profile. It lowers
typed Values and Conditions by node kind, preserves Candidate bindings and
axis/domain identity, computes Score and Selection independently, evaluates
Event/State/Memory before policy selection, aggregates exposure across
independent sleeves, and checkpoints semantic state by identity. No compiler
branch recognizes a strategy name.

The production boundary is nevertheless intentionally bounded. Session clocks,
arbitrary provider instruments, arbitrary control-action topology creation and
native order-ticket restoration are not proven. These remain explicit
capability gates. The versioned execution profile is a supported subset, not a
second strategy language.

The most important defect found during integration was above the compiler:
the Builder capability preflight treated every Event, State, Memory, guarded
allocation and multi-Selection document as unsupported even though the merged
typed lowerer executes the maintained compositions. Preflight now classifies
authoring completeness first and delegates only complete documents to the
strict lowerer. It does not weaken lowering or parse lowering messages to find
normal authoring state.

## Projection contracts

All projections are immutable derivatives of the committed
`SemanticProgramV2` and carry stable semantic addresses.

| View | Contract | Deliberately omitted |
|---|---|---|
| Structure | Ownership, investment containment, Assets, Qualification, Selection, fallback, Split, Rebalance | Arithmetic expression nodes |
| Flow | Portfolio capital routes, parallel splits, selected/fallback branches and reconvergence | Event and State internals without capital consequences |
| Blocky | Clocks, nested Values/Conditions, Score terms, Selection, Event, State, Memory and policy precedence | Structure-only Assets hierarchy |
| Rules | Ordered financial rules with explicit Unknown behavior | Visual containment |
| Summary | Essential portfolio intent, selection and behavioral features | Compiler diagnostics and implementation vocabulary |

The backend semantic-projection endpoint returns all five manifests without
requiring successful production lowering. The frontend uses corresponding
view-specific models; Flow and Blocky no longer serialize the Structure tree.
Projection execution claims are informational and remain separate from
semantic validity.

## Shared authoring boundary

Structure, Add, Inspector and Blocky interactions resolve a semantic address
and dispatch the same typed V2 operation contract. Incomplete fields stay in a
local draft. A commit carries the expected source hash, is validated atomically
on the backend, replaces the committed Canonical document and then reprojects
all views. Existing revision, undo/redo and stale-CAS behavior remains the sole
history mechanism; no view owns semantic state.

The Event-to-State affordance is one restricted, honest operation: it creates
an observed adjusted-close comparison, rising-edge Event, declared initial
State and guarded transition together. It does not expose raw Program JSON or
commit half a State machine. Multi-investment Selection authoring resolves the
selected/incomplete Investment instead of silently editing the first sleeve.

## Execution, persistence and evidence

Test consumes only the committed Canonical V2 document. Blank, Investment-only
and unfinished Selection states are semantically valid but execution-incomplete.
Unsupported semantics, provider readiness, runtime availability and execution
failure remain distinct states. Complete supported documents follow:

`validation → typed plan → generated C# → LEAN → structured evidence`

Evidence continues to use the existing Strategy/Revision/Run provenance and
semantic identifiers. This change does not fabricate a second persisted
evidence store. Save/reopen preserves the V2 discriminator and semantic hash;
drafts are never persisted. Historical V1 revisions remain on their existing
compatibility projections and execution path and are not rewritten.

## Capability and retained adapters

The machine-readable matrix is
`corpus/semantic-builder-capability-matrix.json`. Each of representability,
Builder reachability, persistence, reference evaluation, lowerability and
Docker proof is reported independently. The V1 `ProductBlockyProjection` and
V1 product projections remain only as compatibility adapters. New V2 Blocky
and Flow rendering use Program-native logic and capital projections.

Known gaps are explicit: weekly Clocked Value creation is not yet a production
Inspector operation; arbitrary IF/OTHERWISE action topology and arbitrary Event
composition remain gated; the Builder can author and persist a multi-Selection
split but the unguarded form remains unsupported by the strict lowerer (the
guarded-policy engine corpus is independently Docker-proven); session/intraday
and unproven provider instruments remain unsupported.
