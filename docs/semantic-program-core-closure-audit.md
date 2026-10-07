# Semantic Program Core closure audit

This audit records the disposition of the in-progress PR #46 implementation after
the 169-case natural-language strategy corpus changed the roadmap priority. It is
not a deletion plan and it does not claim that generalized authoring is complete.

## Decision

Before expanding generalized authoring UI, RuleTrade needs a representation-neutral
Semantic Program Core that can express program structure, bind typed Values and
Conditions into statements, and provide one stable input to validation, execution,
projection, persistence, and Evidence.

The existing PR work remains useful, but the current top-level v2 envelope is
Selection-shaped rather than Program-shaped. The next batch must close that core
boundary before UI breadth increases.

## KEEP

These changes are required independent of the eventual editor surface.

| Area | Files | Reason |
|---|---|---|
| Explicit v1/v2 identity | `strategy/v2/models.py`, `strategies/models.py`, `strategies/serialization.py`, `strategies/service.py`, `persistence/sqlite_strategies.py`, `hashing.py` | Versioned parsing, immutable revisions, semantic hashing, and exact reopen are Program Core prerequisites. |
| Work 2 Value reuse | `strategy/v2/models.py`, `strategy/v2/bridge.py` | `DailyValueNode` remains the typed Value algebra; no parallel expression grammar should be introduced. |
| Recursive Condition algebra | `strategy/v2/models.py` | Comparison, ALL, ANY, and NOT are reusable Program expressions. |
| Type and safety validation | `strategy/v2/validation.py` | Lexical Candidate binding, type compatibility, bounded recursion, provider truth, and readiness checks belong below every authoring surface. |
| Deterministic semantic evaluation | `strategy/v2/execution.py` | T/F/U evaluation, ranking, shortage, fallback distinction, provenance, and deterministic Selection evaluation form a reference execution boundary. |
| Source-hash concurrency | `strategy/v2/authoring.py` | Compare-and-swap against the exact Canonical source remains required for future Program edit intents. |
| Capability truth | `strategy/v2/authoring.py`, `api.py`, foundation tests | Adjusted-close support and explicit raw/volume/provider limitations must remain honest. |
| Central semantic summaries | `frontend/src/domain/v2Semantics.ts` | Representation-independent Value and Condition descriptions are reusable by future projections. |
| Version-aware frontend transport | `frontend/src/strategyApi.ts`, `App.tsx`, `StrategyEditor.tsx` | Existing v1 behavior must remain isolated while v2 revisions retain their exact version. |
| Backend regression evidence | `tests/test_semantic_language_v2_authoring.py`, `tests/test_semantic_language_v2_foundation.py` | The tests pin lexical scope, atomicity, persistence identity, provider honesty, T/F/U Selection behavior, and Evidence provenance. |

## ADAPT

These changes point in the right direction but must be connected through the
Program Core rather than remain Selection-specific parallel architecture.

| Area | Current shape | Required adaptation |
|---|---|---|
| Canonical v2 root | Top-level `selection` and optional `predicate` | Introduce an explicit semantic Program/statement structure. Selection and Control become typed statements or effects with stable semantic IDs. Preserve the existing data while defining the migration/compatibility boundary explicitly. |
| Authoring intents | `set_selection_*` and `set_predicate` mutate root fields | Retarget intents to stable Program semantic addresses and return a full validated Canonical replacement. Keep CAS and atomic failure behavior. |
| Validation entry point | Validates one root Selection plus Predicate | Validate the Program recursively, derive lexical scopes from statement context, and keep expression validation reusable. |
| Execution entry point | Executes Selection directly | Plan/execute a typed Program while continuing to call the existing Condition/Selection evaluators. Program control must determine which statements execute and which Evidence may materialize. |
| Evidence | Strong expression and Selection provenance, returned from an evaluation endpoint | Attach observations/outcomes to Program statement identity, revision identity, and executed path without making UI summaries authoritative. |
| API surface | Separate v2 validate/author/apply/evaluate endpoints | Keep narrow endpoints temporarily, then expose Program-oriented validation and semantic intents through one backend-authoritative contract. |
| Frontend semantic types | Mirror the Selection-shaped Canonical | Add Program statement types and semantic addresses; reuse `DailyValueNode` and `ConditionV2` unchanged. |
| Shared composers | Reusable Value/Condition editors, currently wired directly to Selection root fields | Keep components presentation-independent and emit Program-addressed working edits/intents. Capability options must remain backend-derived. |
| Projections | Minimal hard-coded Summary/Blocky/Flow/Rules markup in `V2StrategyEditor` | Project from the Program Core. Blocky shows decision order, Flow shows capital routing, Rules shows clauses, and Summary stays concise. |
| Documentation | `semantic-language-v2-work3.md` describes the abandoned sequencing as current | Retain as implementation history but mark Program Core closure as its prerequisite before further generalized UI expansion. |

## DEFER

These items should not be expanded in PR #46 until the Program Core contract is
closed. Existing code is retained for evaluation and reuse.

| Area | Files / behavior | Reason for deferral |
|---|---|---|
| Broad generalized editor UX | `V2StrategyEditor.tsx`, `V2SemanticComposer.tsx`, production authoring DOM tests | More controls would harden the Selection-shaped root and create migration work. |
| Full v2 Strategy creation flow | App creation/navigation changes beyond version-safe loading | Creation should start from a valid Program skeleton, not synthesize a special Selection document. |
| Persisted v2 run/research UI | Selection Test result UI, historical Evidence navigation | Run persistence and View Rule must target Program/revision identity after the core shape is stable. |
| Authoring breadth | Arithmetic/reduction builders, unrestricted nested editing, reorder UX | The expression algebra may remain, but user-facing construction waits for Program ownership and semantic addressing. |
| Asset Workspace v2 authoring | Cross-surface “Use in Strategy” integration | It must emit the same Program intent rather than a Selection-specific mutation. |
| Browser acceptance for generalized Work 3 | End-to-end authoring journey | Acceptance should follow core closure and core-backed mounted production tests. |

## Program Core closure entry contract

The next implementation slice in this PR should establish, before further UI
breadth:

1. A versioned, representation-neutral Program root with stable semantic IDs.
2. Typed statement/control/effect nodes that reuse `DailyValueNode`,
   `ConditionV2`, and `SelectionV2`.
3. Recursive validation with explicit lexical scope and bounded complexity.
4. A typed plan/execution boundary with T/F/U control behavior and
   executed-path-only Evidence.
5. Program-addressed atomic semantic intents with source-hash CAS.
6. Deterministic persistence/hash/reopen behavior and an explicit compatibility
   policy for the current Selection-shaped v2 snapshots.
7. Projection contracts consumed by Blocky, Flow, Rules, and Summary without
   creating representation-specific truth.
8. A corpus mapping test that classifies every natural-language case as
   representable, intentionally unsupported, provider-blocked, or deferred.

## Guardrails

- Preserve all v1 behavior and Work 2 numerical parity.
- Do not fabricate provider capabilities.
- Do not automatically migrate v1.
- Do not expand generalized authoring controls before the core is stable.
- Do not delete the current v2 persistence/composer work merely because its
  connection point must change.
- Canonical remains authoritative; working editor state never becomes a second
  Strategy truth.
