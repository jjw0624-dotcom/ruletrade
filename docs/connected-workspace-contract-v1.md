# Connected workspace contract v1

**CURRENT audit, based on the open editable-representations PR #17.** This document describes concrete code boundaries; it does not add future modes or a universal representation model. Until #17 merges, this architecture PR is stacked on its exact head.

## Ownership and lifetime

| State | Current owner | Persistence | Canonical dirty? | View switch / backend replacement |
| --- | --- | --- | --- | --- |
| Strategy ID, name, base Revision | `StrategyEditor` from `strategyApi` | Backend Strategy/immutable Revision | No; base plus working Canonical determines dirty | Retained on switch; Save or Keep advances base |
| Working Canonical, Registry | `StrategyEditorProvider` reducer | Canonical only via Save Revision | Yes after successful authoring; dirty calculated against base | Retained on switch; replaced only from backend apply, reopen or adoption |
| Capabilities, apply status/error | `useAuthoring` | No | No | Requeried for replaced Canonical; one apply owns success/rejection |
| SemanticSelection, active representation, Structure panel | editor reducer | No | No | Selection retained on switch; replaced Canonical clears addresses to absent components |
| Saved Runs, revisions, active Run and load status | `StrategyEditor` + `backtestRunApi` | Runs/Revisions on backend; active choice local | No | Retained on switch; Run lookup is a query |
| Research destination, Decision session/asset, Activity open and width | `workbenchResearchReducer` + `ResultWorkspace` | Run/Evidence/Comparison persisted; navigation/UI local | No | Retained on switch; Result/Decision queries never edit Canonical |
| Evidence, Candidate, Comparison | backend APIs; query state in respective Research components | Backend immutable records | No; only Keep can advance Strategy Revision | Results retain their own historical Revision context |
| Flow positions/viewport; Blockly layout/zoom | xyflow and Blockly inside views | No | No | View-local; Blockly stays mounted after first visit; Canonical replacement reprojects blocks |
| Rules focus, Code scroll, Inspector visibility | local view state / workspace shell | No | No | Reconciled from SemanticSelection and Research open state |
| Test setup, preflight and loading/errors | `StrategyEditor`, `useBacktestRun`, API | Only a submitted saved Run persists | No | Independent of representation |

There is intentionally no second Strategy store in Research. A historical Run has its own `revision_id`; looking at that Run does not replace the current working Canonical. Current selection can navigate to a matching component, but historical values are read from the historical Run/Revision, not assumed equal to today's editor values. An explicit historical-revision inspection mode remains **DEFERRED**.

## Data and dependencies

**CURRENT read:** Canonical + Registry → `semanticProjection` / `conceptualFlow` / `logicRepresentation` / guided read model → Flow (xyflow), Blocky (Blockly), Rules (React), Guide, Summary, Code. These read models may differ in order, structure, and granularity. Evidence → persisted Decision detail and `source_components` → Decision/Result presentation. Candidate and Comparison have their own backend records and Research surfaces.

**CURRENT write:** view gesture → exact operation from backend capability targets → shared `useAuthoring.apply` → backend authoring apply validates atomically → `replace_canonical_dirty` → all representations reproject. Failure leaves Canonical and calculated dirty state untouched. AI preview invokes the stateless backend apply without dispatch; its explicit Apply uses the shared controller. Save posts the working Canonical and expected parent Revision; Test creates a Run only on explicit submission. The hook's pending/error state is shared; each representation controls its own message and focus. There is no demonstrated need for a generic command bus.

**CURRENT dependency direction:** `views/*` and Builder components consume `domain/*`, the shared store and `useAuthoring`; the hook consumes `structuralAuthoringApi`. Research components consume Run/Evidence/Candidate/Comparison APIs and pass a semantic address to `StrategyEditor`. `StrategyEditor` owns the Strategy, Revision, Run and Research orchestration. No Flow→Blocky or Rules→Flow import exists for mutation. The existing conceptual projection is reused where shapes overlap; Blocky's evaluation order remains a separate projection. `projectFlowCanvas` lives in `FlowView` and some tests import it; moving it without a production consumer is **DEFERRED**.

## Semantic address and provenance

The persisted provenance is **Canonical `component_id` plus optional `field_path`** (`source_components` on persisted Decision Evidence). In the frontend `SemanticSelection` adds `role` and `groupId` for focus and presentation. Those extra fields do not define a second semantic identity. `sameSemanticAddress` compares exact component/field across roles; `sameSemanticSelection` remains available for exact UI selection. A component-only Evidence lookup intentionally matches all its fields; a field lookup requires the exact path. Compare Evidence only within its saved Run and Revision. IDs do not promise that a field value is unchanged between Revisions.

`ResultWorkspace` and `DecisionAnalysis` pass persisted `revision_id`, `component_id`, optional `field_path`, and `ResearchContext` to the `StrategyEditor` navigation seam. `focusRule` selects the semantic address in the current representation; `View in Flow` additionally changes the active view. Rule→Evidence queries only successful, non-Candidate Runs for the exact Revision and source address, then opens the saved Research context. AI export uses Canonical and this semantic selection, never xyflow IDs or Blockly serialization. If a backend replacement removes the selected component, the reducer clears it; a surviving component stays selected. A Registry default can back a field absent from raw `config`, so reconciliation checks component existence and leaves field presentation to its view.

## Query and command boundary

| Query or local navigation (no Revision/Run/Candidate creation) | Explicit command |
| --- | --- |
| Open Strategy/Revision, capabilities, Run, Decision Evidence, Comparison | Apply authoring operation to the working copy (no persistence yet) |
| Switch representation, select rule/chart event, inspect Result/Why, Rule→historical Evidence, resize Research | Save an immutable Revision with expected parent |
| AI export and stateless authoring preview | Create persisted Test, Candidate, Comparison, or Keep/adopt |

Decision Evidence records **decision-time** facts. A later market outcome belongs to a different future result/event model; it must not be inserted into `DecisionEvidence` as though it were known when the Strategy acted. Charts render and navigate persisted facts, rather than assigning hindsight judgements.

## Expansion seam and limits

**MVP 1:** A new Strategy representation receives the existing working Canonical, Registry, SemanticSelection and shared authoring controller from the Builder shell. It owns its own projection and visual state, maps gestures to existing semantic operations, and renders backend-returned Canonical. It does not persist its editor serialization as Strategy. Existing infrastructure reuses xyflow, Blockly, React/Radix, resizable panels and LEAN for mechanics.

**FUTURE / DIRECTIONAL:** Feedback Navigation should add chart event → persisted Run/Decision ID navigation in `ResultWorkspace`, query Decision Evidence, then reuse the existing `onShowInStrategy` address + ResearchContext callback. It may add outcome facts separately from decision-time Evidence. Validate and Forward can later enter the existing Strategy shell with the same Strategy/Revision loader and selection, and pass persisted Run/Decision contexts into Research. Their evaluation semantics and routes do not exist yet; build no placeholder mode or new store now.

**DEFERRED:** universal UI AST, event/command bus, Redux migration, generic Strategy-mode framework, graph CRUD, new persistence layer, frontend trading grammar, generic evaluation abstraction, incremental Blockly reconciliation, historical Revision viewer, and bulk AI operations. Code remains read-oriented. API endpoints remain headless and semantic; no `/flow/*`, `/blockly/*`, or `/rules/*` authoring variants are needed.

## Audit findings and scope classification

| Finding | Decision |
| --- | --- |
| `useAuthoring` already centralizes capability query, atomic apply, error mapping and authoritative replacement for Guide/Inspector/Flow/Blocky/Rules/AI | KEEP CURRENT |
| Replacement on reopen/Keep did not validate the selected component against new Canonical; dirty replacement had separate logic | FIX OWNERSHIP / CONSOLIDATE PROVEN DUPLICATION: `selectionInCanonical` in both reducer cases |
| Result-source matching and editor selection independently compare component and field | SMALL SHARED CONTRACT: `sameSemanticAddress` for exact cross-role address; retain Evidence's intentional component-wide lookup |
| Research and Builder share an owner but keep persisted facts and UI navigation separate | KEEP CURRENT |
| `docs/authoring.md` still said Blocky/Rules/Code/AI were unimplemented on #17's head | DOCUMENT ONLY: correct the living contract |
| Historical Run→current working rule may show a value changed since that historical Revision | DEFER explicit historical Revision inspection; keep Revision in navigation/Evidence context and document the limitation |
| Repeated local messages and unsupported-state presentation vary by perspective | KEEP CURRENT; shared hook handles lifecycle, views handle wording |
| Backend authoring, Revision, execution, Evidence, Candidate/Comparison and adoption have distinct endpoints and backend validation | KEEP CURRENT; no UI-specific backend endpoint or duplicated frontend trading normalization found |

Tests in `connectedWorkspaceContract.test.ts` cover backend-returned reprojection, save/reopen API payload and identity, rejection, selection on replacement/Keep and query-only navigation. Existing backend FastAPI/SQLite tests cover the full construction→save→reopen→compile chain and adoption concurrency; these frontend tests do not claim a browser or LEAN runtime run.
