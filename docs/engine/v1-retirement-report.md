# V1 retirement status after the V2 independence stack

Baseline main: `f487633abbbde067e5ef6a1a9f07914bcdbb11cf`.

## Closed in this stack

- Maintained Program-based V2 profiles compile directly to the shared `LeanPlan` without constructing V1 Canonical or invoking V1 validation/compiler.
- V2 model, validation, authoring, reference evaluation and projection modules no longer import V1 models except the isolated migration adapter.
- Canonical version dispatch moved to an explicit persistence/compatibility boundary.
- Strategy metadata and stable Group identities moved to a neutral value-object module while V1 re-exports preserve source and JSON compatibility.
- A deterministic migration dry-run reports current historical V1 artifacts as legacy read-only instead of inventing equivalence.

## Intentionally retained

- `strategy/v1`: historical V1 semantics, fixtures and authoring tests.
- `compiler/frontend` and `compiler/pipeline.py`: V1 compilation for historical and explicit V1 requests.
- `strategy/v2/migration.py`: explicit V1-input compatibility adapter.
- V1 branch in `strategy/versioning.py`: persisted historical revision reader.
- Legacy-shaped V2 documents without `SemanticProgramV2`: explicit temporary conversion adapter.
- Historical BacktestRuns, Results and Decision Evidence: immutable facts.

## Remaining gates

Complete file-level V1 deletion is not safe. Legacy-shaped persisted V2 documents require inventory/migration, and each V1 migration family still needs semantic, plan, Docker Result and Decision Evidence equivalence. No production database migration is performed by this stack.

The default path for new V2 authoring and all maintained Program execution families is V2-native. Compatibility code is isolated and architecture tests prevent the maintained profiles from re-entering the V1 compiler.
