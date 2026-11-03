# V2-native lowering contract

## Authority

`CanonicalStrategyV2` and its `SemanticProgramV2` are the only authored inputs to the maintained V2 compiler. The compiler validates V2 semantics and emits the shared immutable `LeanPlan`. Neither the plan nor generated C# is an editable strategy authority.

## Maintained direct profiles

The following Program profiles must not construct `CanonicalStrategyV1`, call V1 validation, or enter the V1 compiler frontend:

- direct fixed allocation;
- Selection with qualification, ranking, shortage and fallback;
- parallel fixed sleeves;
- conditional allocation;
- weighted Score with proportional allocation;
- temporal Event/State/Memory;
- completed-weekly context with daily decisions;
- composable temporal Selection and split policies.

The architecture test replaces both V1 conversion and V1 compilation entrypoints with failing sentinels and compiles every maintained profile.

## Strict capability boundary

Direct lowering accepts only the already maintained subset. It does not infer missing selections, assets, weights, clocks or state. Unsupported bounded allocation, Score condition terms, target kinds, clocks and temporal shapes raise `V2LoweringError`. Draftability and semantic validity therefore remain distinct from production lowerability.

## Identity and evidence

V2 semantic IDs flow into Selection, eligibility, Score, allocation, rebalance and fallback plan addresses. Direct lowering intentionally replaces legacy synthetic component IDs with authored V2 semantic addresses. Decision evidence records an eligibility expression as `filter_field=condition`, not as a synthetic threshold configuration field.

## Compatibility

The explicit V2-to-V1 adapter remains available only for legacy-shaped V2 documents without a Program and for migration/equivalence work. It is not the maintained Program default. Removal requires the persisted-data policy and historical compatibility gates.
