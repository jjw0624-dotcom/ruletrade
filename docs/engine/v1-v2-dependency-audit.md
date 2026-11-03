# V1/V2 dependency audit

Baseline: `main@f487633abbbde067e5ef6a1a9f07914bcdbb11cf`.

## Authoritative finding

New authoring and persisted V2 revisions are V2-authoritative, but production execution is not yet fully V2-independent. `strategy/v2/bridge.py` contains both a direct V2 → `LeanPlan` compiler and a compatibility path that constructs `CanonicalStrategyV1`, invokes `validate_strategy_v1`, and calls the V1 compiler pipeline.

The direct path already covers bounded static allocations, conditionals, temporal/stateful execution, multi-clock execution, and parts of composable Selection. The legacy path is still selected for legacy-shaped V2 documents, established equal-weight Selection corpus addresses, and the weighted Score topology replacement path.

## Dependency classes

| Area | Classification | Authority | Current dependency |
|---|---|---|---|
| `v2/models.py` | V2-native plus shared-model debt | V2 semantics | Imports V1-located metadata/group types and union parser |
| `v2/validation.py`, `program_validation.py` | V2-native | V2 validation | No V1 validation dependency |
| `v2/authoring.py` | V2-native plus shared-model debt | Typed V2 mutation/CAS | Imports V1-located value objects |
| `v2/execution.py`, `program_execution.py` | V2-native | Deterministic reference evaluation | No V1 dependency |
| `v2/bridge.py` direct static/temporal code | Temporary mixed module | Production lowering | Produces shared `LeanPlan` directly |
| `v2/bridge.py` conversion code | Temporary bridge | Production lowering for remaining profiles | Constructs and validates V1 Canonical |
| `v2/migration.py` | Compatibility adapter | Explicit legacy upgrade | Accepts V1 input by design |
| `compiler/lean/plan.py`, `codegen.py` | Shared infrastructure | Derived execution artifacts | Strategy-version independent |
| persistence/API | Shared with version dispatch | Revisions/Runs/Results | Reads both versions; V2 runs call mixed lowering module |
| frontend projections | V2-native projections | Derived UI read models | V2 Canonical remains authoritative |

## Runtime lineage

V2 Strategy creation and editing use typed operations and immutable revisions. Execution capability, persisted BacktestRun execution, CLI generators, and Docker fixtures call `compile_v2_strategy_to_lean_plan`. That function first runs V2 validation. It can then either emit `LeanPlan` directly or call `lower_v2_to_v1` followed by the V1 compiler.

This means V1 is not the authored authority, but it is still an execution implementation dependency for maintained profiles. The distinction is material: deleting V1 now would break otherwise supported V2 execution.

## Safe extraction sequence

1. Freeze dependency direction with AST-based architecture tests and this machine-readable inventory.
2. Move direct V2 lowering behind a V2-native compiler interface that imports neither V1 models nor V1 validation.
3. Reproduce equal Selection, fallback, weighted Score/allocation, parallel, conditional and temporal plans directly from V2 semantics.
4. Compare semantic decisions, typed plans, generated C#, Docker results and evidence before removing each bridge call.
5. Move shared metadata/group value objects to a neutral module without changing JSON schemas.
6. Keep V1 migration and historical readers isolated until persisted-data policy is approved and tested.

## Retirement decision

V1 removal is currently unsafe. The safe target for the next implementation stack is a V2-native default production compiler plus an explicit legacy read/migration boundary. Historical Results and Decision Evidence remain immutable facts and must not be regenerated.
