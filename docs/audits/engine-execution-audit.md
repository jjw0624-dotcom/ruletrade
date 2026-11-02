# Engine execution audit

## Actual pipelines

### Persisted historical pipeline

`RevisionRecord (V1)` → semantic validation → market-data preflight → V1 compiler → typed LEAN plan → generated C# → `DockerLeanRunner` → normalized result + log evidence → evidence validation → SQLite Run/result/evidence → V1 Run API → frontend historical result.

This is the only path that currently provides immutable Run identity, source hash, engine image, dataset/provider provenance, final status, stored result, and retrievable Decision Evidence.

### New-strategy transient pipeline

`CanonicalStrategyV2 working copy` → execution capability preflight → strict V2 bridge → V1-compatible transient request → validation/compiler/codegen → Docker LEAN → normalized response → frontend Quick Test detail rail.

This path is real LEAN execution, but it does not create a persisted Run or preserve V2 Decision Evidence history.

## Transition contracts

| Transition | Contract | Evidence | Gap |
|---|---|---|---|
| Revision → validation | Immutable revision contains parsed Canonical and stable source hash | strategy persistence tests | None for storage |
| Validation → capability | V2 authoring validity is separate from execution completeness/support/runtime | execution capability tests | Provider preflight is not integrated into the same V2 capability response |
| Capability → lowering | Only `executable` documents enter strict lowerer | V2 capability and bridge tests | Transient endpoint itself does not require a capability token/snapshot |
| Lowering → artifact | Typed plan plus run config deterministically generate C# | codegen tests and drift generation | Lowerer/build version is not a first-class V2 response field |
| Artifact → LEAN | Docker runner compiles/runs pinned environment | maintained Docker scripts | Image digest is not uniformly asserted in all transient evidence |
| LEAN → normalized result | Result JSON becomes bounded `BacktestResult` | normalization tests | Positions and allocations are not part of the normalized public model |
| LEAN logs → evidence | Structured evidence parsed and source component IDs checked | BacktestRunService tests | Persisted only on V1 Run path |
| Result → persistence | Atomic status finalization with result/evidence | SQLite Run tests | No V2 persisted execution path |
| Persistence → API | Run and Decision Event GETs | API/backtest tests | V2 Quick Test cannot reopen these |
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

## Required engine closure

The next engine PR should make persisted execution version-aware without creating a second engine:

1. accept the stored `CanonicalStrategy` union at the Run boundary;
2. assess V2 capability before execution;
3. lower the exact stored V2 revision through the maintained bridge;
4. preserve the original V2 revision ID and semantic fingerprint in provenance;
5. store normalized result and structured evidence under one Run ID;
6. return explicit validation/unsupported/provider/runtime/execution failure categories;
7. add a real Docker-backed API integration test for create/load → execute → poll/read → evidence/read;
8. prove zero-order success remains success.

No hidden V1 strategy creation or semantic rewrite is acceptable.

