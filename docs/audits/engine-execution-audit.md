# Engine execution audit

## Actual pipelines

### Persisted version-aware pipeline

`RevisionRecord (V1 or V2)` → version-specific semantic validation → version-specific strict lowering → one typed LEAN plan → plan-derived market-data preflight → generated C# → `DockerLeanRunner` → normalized result + log evidence → plan-provenance validation → SQLite Run/result/evidence → versioned Run API.

The persisted source remains the original revision. V2 is never rewritten into a hidden V1 strategy: the shared executor consumes the maintained V2 plan while provenance retains the V2 revision ID, semantic hash and schema version.

### New-strategy transient pipeline

`CanonicalStrategyV2 working copy` → V2 validation → strict V2 plan → plan-derived market-data preflight → shared codegen/Docker LEAN → normalized response → frontend Quick Test detail rail.

This compatibility route remains intentionally transient. Saved V2 strategies use the persisted route instead.

## Transition contracts

| Transition | Contract | Evidence | Gap |
|---|---|---|---|
| Revision → validation | Immutable revision contains parsed Canonical and stable source hash | strategy persistence tests | None for storage |
| Validation → capability | V2 authoring validity is separate from execution completeness/support/runtime | execution capability tests | Provider preflight is not integrated into the same V2 capability response |
| Capability → lowering | Only `executable` documents enter strict lowerer | V2 capability and bridge tests | Transient endpoint itself does not require a capability token/snapshot |
| Lowering → artifact | Typed plan plus run config deterministically generate C# | codegen tests and drift generation | Lowerer/build version is not a first-class V2 response field |
| Artifact → LEAN | Docker runner compiles/runs pinned environment | maintained Docker scripts | Image digest is not uniformly asserted in all transient evidence |
| LEAN → normalized result | Result JSON becomes bounded `BacktestResult` | normalization tests | Positions and allocations are not part of the normalized public model |
| LEAN logs → evidence | Structured evidence parsed against V1 graph IDs or exact V2 plan IDs | BacktestRunService tests | Browser evidence navigation remains unproven |
| Result → persistence | Atomic status finalization with result/evidence for V1 and maintained V2 | SQLite Run tests | Unsupported V2 remains a failed Run without result |
| Persistence → API | V1/V2 Run and Decision Event POST/GET routes | API/backtest tests and Docker API journey | Frontend Quick Test still uses the transient route |
| API → frontend | Historical Run and transient V2 panels | frontend tests | One browser journey across both is unproven |

## Execution invariants

- **Revision identity:** immutable revision row and parent lineage are enforced by SQLite and service CAS.
- **Semantic hash:** `strategy_hash` is distinct from serialized snapshot bytes and is stored on revisions and Runs.
- **Determinism:** reference evaluators and generated profiles test ordering, prefix invariance and replay for maintained profiles.
- **Clock boundaries:** completed weekly values are explicitly projected into daily decisions; missing completed context stays unknown.
- **No lookahead:** temporal and composable tests compare future-extended prefixes and completed boundaries.
- **Missing data:** evaluators preserve unknown/reason; market-data preflight rejects unavailable required coverage.
- **Cash/allocation:** lowerers preserve target weights and bounded score allocation; fixed-money investment is not claimed supported.
- **Fallback:** Selection shortage fallback remains distinct from IF/ELSE.
- **Restart/replay:** temporal and composable profiles have fresh-process checkpoint tests; arbitrary state graphs do not.
- **Unsupported semantics:** strict lowerer raises `V2LoweringError`; capability maps that to unsupported rather than silently simplifying.

## Implemented engine closure

The persisted execution boundary is version-aware without creating a second engine:

1. accept the stored `CanonicalStrategy` union at the Run boundary;
2. assess V2 capability before execution;
3. lower the exact stored V2 revision through the maintained bridge;
4. preserve the original V2 revision ID and semantic fingerprint in provenance;
5. store normalized result and structured evidence under one Run ID;
6. return explicit validation/unsupported/provider/runtime/execution failure categories;
7. a real Docker-backed API integration test proves create/load → execute → read → evidence/read;
8. zero-order success remains success through existing normalization tests.

Strict lowering remains the support boundary. Incomplete or unsupported V2 revisions create a failed Run with a typed public error; they are never simplified or padded with hidden semantics.

