# Entry-style unified Builder architecture

## Boundaries

The production `StrategyBuilderWorkspace` remains the only Builder shell. `SemanticProgramV2` remains the committed strategy authority, while `ProgramWorkingDraft` owns incomplete Blockly objects, reusable draft objects, graph activation, geometry, disclosure, and tentative connections. LEAN receives only validated committed semantics; draft-only objects never lower by proximity or by merely existing on the canvas.

| Surface | Decision | Responsibility |
|---|---|---|
| `StrategyBuilderWorkspace` | Keep | Shared shell, representation navigation, Inspector and resizable detail rail |
| `ProgramBlockyProjection` | Adapt | Stable keyed reconciliation of committed blocks plus free draft blocks |
| ReactFlow capital projection | Keep | Capital routing only; split legs remain parallel edges |
| Structure / Inspector | Adapt | Object ownership and contextual editing from the same Program meaning |
| `ProgramWorkingDraft` | Extend migrated v3 | Native Blockly JSON, object library, active roots, local recovery, plus Flow layout |
| Product toolbox | Native Blockly category toolbox | Entry-style shaped flyouts; Flow retains its separate capital vocabulary |
| Asset Workspace / `ProgramAssetUniverseEditor` | Keep and reuse | Search, provider status, large selected lists, reorder and Group membership |
| `SemanticProgramV2` authoring API | Keep | Typed validation, source hash and CAS operations |
| execution capability and lowerer | Keep | Explicit authoring/execution boundary and strict production lowering |
| historical V1 adapter | Keep | Saved strategy compatibility; no V1-to-V2 rewrite |

## Root causes fixed

1. The v2 Working Draft stored one `concept`, so starting another operation replaced the prior incomplete fragment. Schema v3 stores independently identified `canvasBlocks` and reusable objects.
2. Earlier projections reconstructed the Blockly workspace wholesale. The Program projection now reconciles by stable semantic/draft identity and only creates, updates, connects, or removes the affected block.
3. A draft type fallback rendered Group, Investment, and other drafts as an allocation/control-looking block. Draft-to-block mapping is explicit; Investment renders as Investment with typed target and amount slots.
4. Selection lived only in canonical-node lookup, so draft block focus could be lost after reconciliation. Draft identities now participate in click selection and selection restoration.
5. Toolbox availability was inferred from backend/canonical context, preventing free composition. Blocky instantiation is always draftable; runtime status is metadata and the capability gate remains downstream.
6. Connection intent used four engine-oriented buckets and could treat proximity as meaning. Entry blocks now expose real Blockly checks for Statement, Truth, Number, Percentage, Money, Quantity, Duration, Asset, Group, Subgroup, Value, Signal, Function, and State.

## Commit rule

Canvas objects are not canonical. A user may keep disconnected alternatives indefinitely. `activeGraphRootIds` records explicit activation, but activation alone does not mutate the strategy: a supported operation still has to validate through the existing authoring API and CAS boundary. Unsupported loops, waits, randomness, signals, variables, and functions remain durable Working Draft objects with technical capability metadata.

## Product semantics

- Group is reusable membership and never capital.
- Choose consumes a Group/Subgroup and produces dynamic Subgroup membership; it never allocates.
- Investment consumes available cash and has typed Target and Amount slots. Money and Quantity drafts are not translated into target weights.
- Rebalance is a separate target-weight action.
- Blocky expresses decision logic. Flow expresses capital routing. Structure expresses ownership. All committed projections read one `SemanticProgramV2`.
- Quick Test exposes period and initial capital. Recurring contributions remain absent until maintained execution supports them; advanced assumptions stay in Detailed Backtest.

## Capability policy

Verified blocks may participate in a supported committed graph. `needs_context` blocks require complete compatible semantics. `draft_only` blocks are composable and persistent but block execution if activated. Technical details remain observable without leaking engine language into normal product labels.

## Mandatory open-source reuse audit

The audit was performed against the exact locked versions in `frontend/package-lock.json`. No dependency was added.

| Feature | Classification | Library/API | Locked version / maintenance | Dependency impact | Remaining RuleTrade work |
|---|---|---|---|---|---|
| Logic comparisons, AND/OR/NOT | 1. Reuse built-in | Blockly `logic_compare`, `logic_operation`, `logic_negate` | Blockly 13.3.0; current Google-maintained core | None | Map typed visual intent to V2 truth semantics without collapsing Unknown |
| Arithmetic and number literals | 1. Reuse built-in | Blockly `math_arithmetic`, `math_number` | Blockly 13.3.0 | None | Financial unit checks stay on RuleTrade slots |
| IF and loops | 1. Reuse built-in | Blockly `controls_if` mutator, `controls_repeat_ext`, `controls_whileUntil`, `controls_flow_statements` | Blockly 13.3.0 | None | Loop execution remains gated; IF translation uses semantic operations |
| Variables, lists, procedures | 1. Reuse built-in | Blockly variable model/blocks, list blocks, procedure definition/call blocks | Blockly 13.3.0 | None | Stable object identity, financial types, purity and side-effect policy |
| Block shapes and connection checking | 1. Reuse built-in | Native output/value/previous/next/statement connections and renderer geometry | Blockly 13.3.0 | None | RuleTrade check names for Asset, Group, Subgroup, Money, Quantity, Duration, Signal, State |
| Toolbox and previews | 1. Reuse built-in | JSON category toolbox and native flyouts | Blockly 13.3.0 | Removes the V2 React text-card palette | Dynamic reusable-object references and Group creation button |
| Drag/drop, pan/zoom, disposal, focus, undo/redo | 1. Reuse built-in | `WorkspaceSvg`, Blockly events, native history, trashcan and Zelos renderer | Blockly 13.3.0 | None | Bridge shared Builder toolbar and Inspector selection |
| Save/reopen | 1. Reuse built-in | `Blockly.serialization.workspaces.save/load` JSON | Blockly 13.3.0; JSON is Blockly's recommended format | None | Store inside Working Draft v3 and migrate legacy maps |
| Capital Flow | 1. Reuse built-in | React Flow nodes, Handles, connection validation, controlled positions and viewport | `@xyflow/react` 12.12.0; maintained xyflow release | None | Only financial-capital nodes and typed CAS operations |
| Instrument chart | 1. Reuse built-in | Lightweight Charts | 5.2.1 | None | Existing provider series/adapters only |
| Group Workspace | 3. Adapt existing RuleTrade code | `ProgramAssetUniverseEditor`, catalog/provider metadata and price chart | Repository-owned | None | Object lifecycle and empty-slot continuation |
| Financial blocks | 4. Custom only where necessary | Start, market values, Choose, Investment, Rebalance, Signal, State | Registered on Blockly core | No plugin | Strict product types and execution capability evidence |
| Visual-to-semantic boundary | 4. Custom only where necessary | `validateActiveVisualGraphs` → product operation adapter → V2 authoring API/CAS | Repository-owned | None | Only complete supported active graphs can request commit |

Official API decisions follow Blockly's JSON serialization, category toolbox, dynamic flyout, connection-check and native workspace guidance, and React Flow's controlled-state/Handle/connection-validation contracts. A plugin search found no requirement that core 13.3.0 did not already cover, so no Blockly plugin was introduced.

## Native ownership and migration

`blocklyWorkspace` is now the persisted source of truth for Blocky block IDs, field values, connections, coordinates and collapsed state. The older `blockPositions`, `blockConnections`, and `blockDisclosure` maps remain as a derived compatibility projection while v1/v2/v3 stored drafts migrate; they do not drive an independent React block editor. React Flow continues to own Flow geometry because Flow is a different capital-routing perspective.

Native workspace JSON is loaded once when the production Blocky workspace mounts. Blockly events then atomically derive the compatibility projection and persist local recovery. Native undo/redo operates on the same event stream, so rapid create/connect/move/delete actions do not require a second hand-written history implementation.

## Object and empty-slot continuation

Creating a Group invokes the existing large Asset Workspace and does not insert a block. Explicit Group references are generated dynamically in the Assets flyout. If Group creation is requested while an Investment/Choose target slot is selected, the pending slot address is held outside Canonical; successful creation inserts and connects one reference, while discard clears the pending address without changing the original graph.

## Honest execution boundary

`entryCapabilityMatrix.ts` records draftability, semantic representation, reference evaluation, lowerability, Docker evidence, provider-data need and runtime timing separately. Visual availability is never used as the execution-capability answer. Signal delivery/reentrancy/replay, bounded loop order safety, deterministic random seeds, calendar-versus-trading waits, variable mutation, typed function execution, fixed-money/quantity orders and options contracts remain draft-only until their contracts are closed.
