# Future Builder migration against SemanticProgramV2

This is an implementation-ready plan, not a UI change in the current Work.
The target remains:

`Existing Builder shell → view-specific projection/interaction → shared semantic operations → SemanticProgramV2`

## Disposition

| Existing area | Decision | Migration contract |
|---|---|---|
| Application shell, navigation, workspace layout, keyboard and viewport behavior | KEEP | Preserve routes and product interaction expectations. |
| `StrategyBuilderWorkspace` and shared representation navigation | KEEP | Continue as the sole production Builder. |
| Historical V1 adapter | KEEP | Preserve immutable V1 revisions and the maintained compatibility path. |
| ReactFlow canvas | REUSE WITH ADAPTATION | Render the backend-neutral Flow manifest; do not derive capital meaning independently. |
| Blockly workspace / Blocky styling | REUSE WITH ADAPTATION | Render computation/decision manifests, not Structure-shaped product nodes. |
| Structure panel interaction patterns | REUSE WITH ADAPTATION | Bind nodes to stable semantic addresses from the Structure manifest. |
| Asset interaction surfaces | REUSE WITH ADAPTATION | Emit the shared Selection/AssetSet semantic operation. |
| Inspector panel | REUSE WITH ADAPTATION | Resolve `InspectorAddressManifest` and emit registered operations only. |
| Frontend `ProductStrategyProjection` semantics | REPLACE incrementally | Consume repository projection contracts or a schema-equivalent API; remove duplicated inference after parity. |
| Representation-specific mutation logic | REMOVE | Every edit must become one validated semantic operation with source-hash CAS. |
| Raw Program/AST editor as a product surface | REMOVE / KEEP DEVELOPER-ONLY | It cannot become the normal authoring path. |
| Separate V2 Builder or navigation shell | REMOVE | V1 compatibility and V2 authority stay behind the one Builder. |

## Migration sequence

1. Expose versioned projection and Inspector-address manifests from the backend.
2. Add parity tests comparing current product projections with the new contracts
   for historical Strongest ETFs, Growth + Defensive, Blank V2, and completed V2.
3. Switch Summary and Rules first because they are read-only and low risk.
4. Switch Structure address resolution without changing styling or interaction.
5. Switch Flow to the capital manifest and Blocky to the computation manifest.
6. Route Inspector commits through the operation registry and existing CAS.
7. Delete only duplicated frontend inference proven unused by parity tests.
8. Keep historical V1 acceptance and V2 save/reopen/execution gates throughout.

## Hard gates

- No new Builder or V2-specific workspace.
- No authoritative UI state.
- No automatic V1 migration.
- No feature becomes reachable because it is reference-evaluable alone.
- Save/reopen must preserve Canonical hash and semantic addresses.
- Incomplete authoring remains representable without invoking the lowerer.
- Provider support, backend lowering, Docker verification, and UI authorability
  remain independent capability dimensions.
