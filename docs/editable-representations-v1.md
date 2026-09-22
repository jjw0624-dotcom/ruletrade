# Editable Strategy representations v1

**Status: CURRENT.** Read with [living architecture](architecture.md) and [authoring contract](authoring.md). The Canonical model, Registry and backend authoring endpoints remain semantic authority.

## Perspective and boundary

| Surface | Product question | Source/model |
| --- | --- | --- |
| Summary | What is this Strategy overall? | Existing read projection; mainly read-oriented |
| Guide | How do I understand/edit it step by step? | Existing guided read model and shared Inspector |
| Flow | Where does capital or ownership flow? | Existing conceptual Flow + xyflow nodes, edges and local viewport |
| Blocky | What is evaluated, and in what order? | Distinct `logicRepresentation.ts` projection + Blockly workspace |
| Rules | What are its explicit rules in ordinary language? | React sentences and inline controls from conceptual semantics |
| Code | What are the precise authored components and connections? | Exact Canonical JSON, read-oriented; fields edited via shared Inspector |
| AI | How can an external personal model reason and propose changes? | Visible Markdown/JSON export and one-operation proposal review |

```text
Canonical + Registry → perspective-specific projection → editor/presentation
gesture → exact semantic intent → backend capabilities/apply → validated Canonical
        → all views reproject; Save creates an immutable Revision separately
```

Selection is `component_id + optional field_path + role/group`. Where a view has no exact visual counterpart it retains selection in the Inspector and can show a nearby concept. Block IDs, xyflow IDs and text positions never become provenance. Blockly blocks and zoom are UI-local. Blocky uses a lazy chunk; its serialized workspace is never saved as Strategy. Dragging a qualification from its capability-driven Blockly toolbox submits one semantic add. Numeric fields use a pessimistic validator: the displayed value only changes when backend apply returns valid Canonical. Rejected adds and fields reconcile to the prior state. Other structural Add actions reuse the existing panel/controls with explicit intent. Blockly's own semantic undo and arbitrary rewiring are disabled. Flow retains its current contextual Add; free port wiring is still unsupported.

## Supported operation coverage

Cells show current *surface behavior*, not every backend operation. `ADD/REMOVE` is only shown for exact backend capability targets. `EDIT` always calls authoring apply. `READ` retains semantic selection and Inspector access. `DEFER` explicitly marks a missing direct control. Summary is intentionally read-oriented.

| Concept | Guide | Flow | Blocky | Rules | Code |
| --- | --- | --- | --- | --- | --- |
| Assets / universe | EDIT via Inspector | EDIT via Inspector | READ, Inspector EDIT | EDIT inline | READ, Inspector EDIT |
| Selection / Choose | ADD via Inspector | ADD via contextual palette | ADD via control | READ, Inspector ADD | READ, Inspector ADD |
| Trailing-return lookback | EDIT via Inspector | EDIT via Inspector | EDIT field | EDIT inline | READ, Inspector EDIT |
| Qualification | ADD/REMOVE via Inspector | ADD/REMOVE via palette/selection | ADD via toolbox; REMOVE selected | ADD/REMOVE inline | READ, Inspector ADD/REMOVE |
| Threshold | EDIT via Inspector | EDIT via Inspector | EDIT field | EDIT inline | READ, Inspector EDIT |
| Ranking / Top N | READ and count EDIT | READ and count EDIT via Inspector | READ rank, EDIT count field | READ rank, EDIT count | READ, Inspector EDIT |
| Fallback | ADD/REMOVE via Inspector | ADD/REMOVE via contextual Add | ADD via control, REMOVE selected | ADD/REMOVE inline | READ, Inspector EDIT |
| Cooldown | ADD/REMOVE via Inspector | ADD/REMOVE via contextual Add | ADD via control, EDIT field, REMOVE selected | ADD/REMOVE/EDIT inline | READ, Inspector EDIT |
| Group / allocation | EDIT two-sleeve allocation via Inspector | Growth/Defensive shortcut; EDIT via Inspector | READ grouping, Inspector EDIT | READ and EDIT two-sleeve allocation | READ, Inspector EDIT |
| Schedule | EDIT via Inspector | EDIT via Inspector | READ, Inspector EDIT | EDIT inline | READ, Inspector EDIT |

The complete backend operation union also supports group rename, random-selection resampling and fallback asset-set choice. This table does not imply arbitrary condition trees, N-sleeve portfolios, generic graph mutation or arbitrary Strategy code. The projection explicitly degrades unsupported or ambiguous shapes. Directly editable Blocky fields are limited to the exact numeric concepts its logic perspective represents; other values are available through shared selection and Inspector.

## AI handoff v0

The visible export contains a human explanation and `ruletrade.ai-context/v0` JSON: working Canonical, Revision ID (if saved), exact selected component and field/current value, current backend capabilities and instructions to propose an operation. When a saved Research context is open, persisted Decision events for that session are fetched and included as **decision-time evidence**. A missing event load leaves the Strategy export available and labels that context unavailable. Later outcomes are not conflated with decision evidence. No model API is called.

The import format is JSON with `format: "ruletrade.change-proposal/v0"` and exactly **one** operation from a restricted subset of the existing Authoring Contract. The parser checks kind, target against current capabilities and required intent; preview calls backend `apply` statelessly and shows changed component/config or asset definitions. Only a separate user Apply submits the operation again against the current working Canonical. A changed source invalidates the preview. Unsupported suggestions receive an explicit error; AI cannot supply Canonical as authority. One operation avoids partial multi-step application in v0.

## Lifecycle and acceptance

Changing views neither saves nor executes. On successful authoring, the one working Canonical is replaced, dirty state updates, and Summary/Guide/Flow/Blocky/Rules/Code/AI reproject. Save and persistent Test retain their existing Revision/LEAN path. Persisted Result → View rule uses shared `SemanticSelection`; Blocky and Rules focus the matching component and Code scrolls to its exact component. When a shape or field is not representable, the Inspector retains exact provenance.

Manual WSL/browser handoff:

```sh
git checkout feature/editable-representations-v1
make bootstrap
make api                 # terminal 1
make frontend            # terminal 2
```

Open the app: One Investment → Flow Add assets/Choose → Blocky Add qualification and set threshold → Rules edit count/lookback or another eligible concept → switch back and select the condition across Flow/Blocky/Rules → Save/reopen → persistent Test with configured LEAN data → Decision/View rule → change representation → AI copy selected context → paste an exact-ID one-operation proposal → Preview → Apply → inspect all views and Save. A complete LEAN dataset with required Security Master files is needed for the Test portion. Browser keyboard focus, Blockly toolbox drag/rejection, local viewport persistence, dense multi-group blocks and clipboard permissions remain manual acceptance items.

## Limits and follow-up

- Code is read-oriented: editable arbitrary text needs a restricted parser and span/provenance tracking. Generated C# remains a compiler artifact.
- Blockly supports the current projected shapes and one capability-driven drag insertion (qualification). Other supported additions use existing semantic controls; block relocation and generic snapping do not change Strategy structure.
- Selected component positions are ephemeral UI state. Blocky viewport survives representation switching while the workspace remains mounted; a full Canonical reprojection rebuilds blocks. Persisting layout and incremental reconciliation are deferred.
- Semantic undo is not delegated to Blockly. A later undo design must respect backend validation and Revision semantics.
- AI proposal v0 is one operation, not a graph program, Canonical import, or embedded chat. Decision export is available only when a saved Research context is present and events load.
