# Builder implementation contract audit

Audited against the production `SemanticProgramBuilderAdapter`, Working Draft v3, native Blockly workspace, React Flow projection, typed authoring adapters, persistence, capability preflight, and browser harness.

| Area | Status | Evidence / defect |
|---|---|---|
| Canonical authority and CAS | compliant | typed V2 authoring and immutable revisions |
| Rules direct editing | compliant | Rules-owned inline financial intent and typed commit |
| Save/reopen | compliant | revision and Working Draft hydration tests |
| Guide independence | corrected in this change | Guide recipes previously selected Blocky; Guide now retains its surface and owns the unfinished intent |
| Flow draft independence | compliant for create; partial for delete | create uses financial intent without Blocky; unsupported disconnect is preserved but lacks a supported removal operation |
| Blocky Group insertion | partial | stable object reference exists; Add/Group modal interaction requires broader browser coverage |
| Structure/Add/Objects isolation | partial | mounted tests cover panel separation; Objects insertion still explicitly targets Blocky |
| Draft conflict recovery | contract present, implementation partial | conflict corpus exists; product resolution UI is absent |
| UI-authored Test | partial | persisted V2 browser execution is proven; broader authored strategy equivalence is not |

The V2 engine is not implicated by UI-authoring failures unless the emitted Canonical payload differs from a verified execution fixture or the same payload fails maintained lowering.

## Repair decision

Preserve CanonicalStrategyV2, V2 lowering, CAS/revisions, Blockly, React Flow, catalog/workspaces, and Run/Result/Evidence. Repair the current production Builder incrementally. Reconstruct an individual perspective only if its native state ownership cannot satisfy BARCH-001 through BARCH-015 without recurring cross-editor coupling.
