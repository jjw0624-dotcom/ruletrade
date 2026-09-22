# Representation and UI reuse spike

**Date:** 2026-09-22. **Base:** `main` at `f2865f6181170777f2cd4c09ccc92a2e100d64c4`. PR #15 (Construction v1) was open, not merged, at audit time. Its Cooldown insertion is therefore excluded from this main-based prototype.

## Decision

Use distinct semantic projections for money flow, decision logic, human rules, and eventually Strategy-oriented text. Reuse editors for gestures and rendering; only Canonical and the existing backend Authoring Contract can change Strategy meaning. The isolated [Blockly experiment](../spikes/representation-reuse/README.md) proves a narrow add/edit/remove round trip through real FastAPI and SQLite. It does **not** establish a production-ready Blocky editor or browser interaction quality.

**Roadmap: PROTOTYPE ONLY for Blocky v0; keep Feedback Navigation next.** One ranked pipeline is tractable; meaningful multiple sleeves, fallback placement, contextual drag, accessible keyboard editing, preserved layout, and robust semantic undo add substantial adapter work. Product learning from Result → Decision → Rule → Candidate remains more urgent than another representation.

## Repository ownership inventory

| Area | Current implementation on main | Ownership and reuse conclusion |
| --- | --- | --- |
| Strategy | `CanonicalStrategyV1`, Registry, validation, typed graph, immutable Revisions | RuleTrade semantics; never editor serialization |
| Mutations | `/v1/canonical/strategies/authoring/capabilities` and `/apply`; exact targets, atomic validated response | RuleTrade authority; reuse in every representation |
| Projection | `semanticProjection.ts` and `conceptualFlow.ts` produce current Builder read models | Existing projection serves Summary/Guide/Flow; create a separate logic read model, not a universal UI AST |
| Flow | `@xyflow/react` 12.11.6, `FlowView.tsx`, semantic nodes/edges, local positions, `nodesConnectable={false}` | Keep xyflow for canvas/selection/viewport; RuleTrade maps Canonical identity and allowed gestures |
| Selection/Inspector | `SemanticSelection` and shared `SemanticInspector` | Keep exact component ID and optional field path; no label/xyflow/block ID provenance |
| Evidence/Research | persisted Decision Evidence, session navigation, Candidate/Comparison, exact source references | RuleTrade owns decision-time facts, provenance, experiment linkage |
| Result charts | custom SVG equity polyline and clickable Decision markers in `BacktestResultPanel.tsx`; SVG Comparison curves | Current working small chart, but zoom/pan/crosshair/density need a chart engine |
| Workspace UI | Radix Collapsible/Tabs/Tooltip, `react-resizable-panels` 4.12.4, React 19 | Keep accessible primitives and resizing |
| Execution | LEAN compiler/lowering, Docker LEAN runner | Keep LEAN execution; Canonical and Evidence remain RuleTrade-owned |

No charting or code-editor dependency is installed on main. Current SVG markers link `sessionId` to navigation, but many markers occupy the same x-axis and the static SVG has no zoom/pan or event density policy. Comparison uses another small SVG chart.

## Candidate evaluation

Ratings are qualitative judgments for **RuleTrade's intended job**, not claims of general library quality. Package versions, published timestamps, licenses, and *unpacked package size* were checked with npm metadata on the date above; unpacked size is **not** application transfer size. The executable Blockly page built to **759 kB minified / 206 kB gzip** including the projection and app code, so lazy loading would be necessary if productized.

| Candidate | Fit/read projection | Edit/identity/reconcile | Capability context, React/TS, access | Performance/bundle, health, license, lock-in | Decision |
| --- | --- | --- | --- | --- | --- |
| xyflow `@xyflow/react` 12.11.6 | High for money flow; controlled nodes/edges and custom handles | High if connection events map to one backend operation; graph arrays must be reprojected | Strong React/TS, keyboard mechanics; domain accessibility still ours | Active Sep 2026 release; MIT; already installed. Some node/edge layout code remains ours | **KEEP CURRENT / EXPAND narrowly** |
| Google Blockly 13.3.0 | High for decision order, nested logic, editable fields, snap/toolbox; projection requires custom blocks | Medium: external mutable workspace must be treated as disposable. Provenance in block metadata; control fields pessimistically or revert on rejection | No first-party React binding required; TS APIs, custom blocks and toolbox; keyboard/screen-reader quality requires hands-on acceptance | Published Sep 2026, Apache-2.0, 17.5 MB npm unpacked; prototype 206 kB gzip. Mature ecosystem; own block/reconciliation adapter | **PROTOTYPE** |
| Rete.js `rete` 2.0.6 + `rete-react-plugin` 2.1.2 | Medium for graph/dataflow, weak match for stacked/nested human logic; overlaps Flow | Medium: plugin editor mutates connections; can intercept and rebuild, but duplicates graph authority | React/TS plugin strong; own accessible semantics/toolbox integration | MIT, React plugin updated Jul 2026; core Jun 2025. Multiple plugin packages and graph-centered model raise adapter cost | **DEFER** for Blocky |
| React + Radix inline controls | High for sentence/paragraph Rules | High: spans/controls map directly to backend targets, replace from Canonical | Existing React/TS and Radix focus/menu support; easy keyboard reading | No new engine/bundle; custom grammar/projection remains ours | **ADOPT** for Rules |
| CodeMirror 6 (`@codemirror/view` 6.43.13) | High for restricted DSL; configurable extensions/decorations | High with a small parser, span→ID map, transaction filters and Canonical reset; arbitrary source remains unsupported | TS-native, React wrapper straightforward, good keyboard editing; custom diagnostics ours | MIT, updated Sep 2026, modular ~1.26 MB unpacked for view; relatively low lock-in | **PROTOTYPE later** |
| Monaco 0.56.0 | High for IDE-like authoring, excessive for editable literals initially | Similar parser/diagnostics requirement; model/worker lifecycle complicates reconciliation | TS strong, React wrappers exist, rich keyboard/IDE features | MIT, updated Jul 2026, ~98 MB npm unpacked (not shipped bundle); heavier setup and workers | **DEFER** |
| Existing SVG Quick Result | Adequate for small static runs and accessible marker buttons | Current session identity handled by RuleTrade | Accessible keyboard controls already explicit; no built-in navigation mechanics | Zero new dependency; custom zoom/pan/density cost grows quickly | **KEEP until Feedback Navigation migration** |
| Lightweight Charts 5.2.1 | High for financial time series and crosshair, markers, zoom/pan, multi-series | Click/crosshair time maps via RuleTrade-owned session ID index; dense same-date decisions still require list/cluster semantics | TS and official React integration guide; canvas needs parallel accessible event list | Apache-2.0 **with TradingView NOTICE and public link requirement**; updated Aug 2026, ~3.1 MB unpacked | **ADOPT for next Quick Result PR**, subject to browser density check |
| Apache ECharts 6.1.0 | High for heatmaps/matrices, brushing, ranges, multiple series; suitable for future Validation | Events expose data index; RuleTrade must map to stable IDs | TS/React integration straightforward; canvas charts need accessible table/list | Apache-2.0, updated May 2026, ~60 MB unpacked; modular imports matter | **DEFER for Quick Result; PROTOTYPE for Validation when specified** |

The table covers intended fit, projection, bidirectional edits, external identity, reconciliation, contextual controls, React and TS integration, accessibility, performance/bundle, maintenance, ecosystem/docs, license, lock-in, and remaining custom mechanics. Ratings are evidence-backed but accessibility and visual performance need a real browser audit before adoption.

Official references: [React Flow controlled interaction](https://reactflow.dev/learn/concepts/adding-interactivity), [handles](https://reactflow.dev/api-reference/components/handle), [connection callback](https://reactflow.dev/api-reference/types/on-connect), [Blockly serialization](https://developers.google.com/blockly/guides/configure/web/serialization), [custom blocks](https://developers.google.com/blockly/guides/create-custom-blocks/blockly-developer-tools), [accessibility status](https://developers.google.com/blockly/accessibility), [Rete React plugin](https://retejs.org/docs/guides/renderers/react/), [Rete editor](https://retejs.org/docs/concepts/editor/), [CodeMirror reference](https://codemirror.net/docs/ref/), [Monaco API](https://microsoft.github.io/monaco-editor/docs.html), [Lightweight Charts API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/IChartApi), [markers](https://tradingview.github.io/lightweight-charts/docs/api/functions/createSeriesMarkers), [license/attribution](https://tradingview.github.io/lightweight-charts/docs/5.0), [ECharts features](https://echarts.apache.org/en/feature.html), and [events](https://echarts.apache.org/handbook/en/concepts/event/). Npm package metadata gives versions/releases/licenses above. React Flow and Rete use MIT, Blockly/Lightweight Charts/ECharts Apache-2.0, Monaco and CodeMirror MIT.

### Flow: narrow direct manipulation

xyflow already provides semantic custom nodes, handles with connection IDs, `onConnect`, drag from palette, viewport, selection, and keyboard mechanics. A future connection gesture is safe only if a backend capability uniquely describes its target operation. `onConnect` should dispatch *intent*, never `addEdge` to Canonical; pending edge decoration is presentation state, accepted Canonical reprojects edges, rejected action clears pending decoration. Contextual handles must derive from backend target IDs, with server revalidation on apply. For multiple possible meanings, continue contextual Add. Auto-layout (e.g., later ELK) can calculate positions separately; it cannot own semantics. Present positions are UI only and can eventually persist in a separate per-user layout record, keyed by Canonical component ID and representation version.

### Blocky: actual prototype and gap

`spikes/representation-reuse` imports the existing `projectConceptualFlow` read model, then builds a **distinct decision-order** projection (`assets → trailing return → optional condition → rank → choose → optional fallback`). No graph mutation or independent Strategy AST is created. Blockly custom blocks render that projection. Block metadata carries the Canonical component ID and field path; Blockly-generated IDs and workspace JSON are disposable. Condition field edits are held pending: the validator returns `null`, the adapter sends `update_qualification_threshold`, and accepted Canonical reprojects. Add/remove buttons are displayed only from capability target lists and use the existing qualification operations. Server rejection leaves the original model and selection intact; a render restores it. The exact unambiguous rank target comes from Canonical provenance plus backend capability.

The live test starts FastAPI with a temporary SQLite database and proves:

1. An existing ranked Strategy projects into logic steps with original Canonical IDs.
2. Capability-driven `add_qualification_condition` returns a validated Canonical and the new condition appears in Flow's projection.
3. `update_qualification_threshold` takes 0% to 5%, then Flow sees the same 0.05 field.
4. A rejected malformed edit keeps Canonical and logic model by reference, without partial mutation.
5. Save Revision and reopen preserve the 5% threshold.
6. A separate backend edit to 7% is seen automatically by a newly projected Blocky session.
7. `remove_qualification_condition` removes the condition and Flow reprojects without it.

The browser page is isolated, has no production nav item, and does not save. The test exercises the real RuleTrade boundary rather than Blockly's own internals. **A browser visual/keyboard run was not performed**. Blockly block drag is intentionally disabled for semantic blocks in this prototype; the add/remove actions are outside the workspace. This establishes bidirectional edit feasibility and bounds, **not** a validated drag/drop authoring experience. Wiring a contextual toolbox to server capabilities, slot checks, multiple groups, clear error decoration, focus/viewport continuity, and keyboard usability are product work.

### Reconciliation and undo recommendation

Use **pessimistic semantic updates** for fields in the first version: keep the current Canonical visible with a pending indicator until apply succeeds. For gestures that necessarily mutate editor state first (drag/create/connect), snapshot presentation state, dispatch intent, and reproject or discard the temporary editor object on rejection. Suppress programmatic editor change events during reprojection to prevent loops. Preserve selection by `(component_id, field_path)`; preserve viewport and block coordinates as separate presentation state. A replaced/removed component clears or relocates focus explicitly. Incremental reconciliation keyed by Canonical IDs may later reduce full-workspace flicker; the spike currently clears/rebuilds and does not prove flicker-free behavior.

Editor-local undo may own viewport, collapse, and layout. **Semantic undo** must submit a backend-supported inverse or restore an earlier validated Canonical working state through an explicit product mechanism, with save/revision rules respected. Blockly's own undo stack must not silently reverse Strategy meaning. Do not persist Blockly JSON, xyflow edge arrays, or generated code as Strategy truth.

### Rules and Code

Rules is a semantic prose projection with typed inline controls. React and Radix are sufficient for supported phrases; arbitrary prose edits are not. Add/remove/values dispatch current capabilities/apply, with exact IDs attached to text spans and server response re-rendering the sentence. The custom RuleTrade work is grammar, field phrasing, provenance, and semantic navigation.

Generated executable C# remains a derived compiler artifact. A future editable Code view should use a restricted Strategy DSL or structured textual representation with a parser that recognizes supported statements/literals, maintains a span→`component_id + field_path` map, rejects arbitrary unsupported syntax, and translates recognized edits into existing authoring operations. CodeMirror's change filters/decorations/diagnostics and smaller modular footprint suit this first exploration; Monaco is justified only for genuinely IDE-scale requirements. Neither editor gets to deserialize arbitrary text into Canonical.

### Result and future Validation

For Feedback Navigation, add Lightweight Charts behind **one** Quick Result chart, not a chart framework rewrite. Project equity series and a RuleTrade-owned `sessionId → Decision IDs` index; use marker/click/crosshair/time APIs for chart mechanics and retain an accessible, virtualizable event list for dense or same-date decisions. Selecting either surface opens the persisted Decision Inspector with its `ResearchContext`. Keep the selected Decision ID in RuleTrade state across chart redraws; use deterministic clustering/list disclosure when markers overlap. Test real marker density, pan/zoom, and the required TradingView attribution in browser before replacing SVG. Do not automatically migrate Comparison SVG until interactions demand it.

Decision-time Evidence and subsequent outcome are separate RuleTrade records/projections. A drawdown range or later price drop is *outcome context*, never a rewritten Evidence annotation or a judgment like “bad buy.” No hindsight event-ranking is in this spike.

Future sensitivity heatmaps and validation matrices are a better potential ECharts job: native heatmap, brush, range and multi-dimensional controls. Wait for actual Validation semantics and data volume before installing it. Accessible tables and textual interpretation remain necessary regardless of chart engine.

## Adoption matrix

| Surface | Decision | External mechanics | RuleTrade-owned layer |
| --- | --- | --- | --- |
| Flow | **KEEP CURRENT / EXPAND** | xyflow | Money-flow projection, capability-to-gesture adapter, provenance |
| Blocky | **PROTOTYPE ONLY** | Blockly in isolated package | Logic-order projection, field/add/remove intent, reconciliation |
| Rules | **ADOPT** existing stack | React + Radix | Human-rule grammar, semantic spans and authoring operations |
| Code | **PROTOTYPE later** | CodeMirror 6 | Restricted DSL/parser, diagnostics, span/provenance map |
| Quick Result | **ADOPT in next PR** after browser check | Lightweight Charts | Persisted Decision index, Evidence, navigation and outcome distinction |
| Validation | **DEFER** | ECharts candidate | Evaluation semantics, matrices, uncertainty and accessible explanation |

## Scope and open risks

The only new dependency is **Blockly 13.3.0 in the isolated spike package**; Vite/TypeScript/Vitest/@types-node are isolated spike development tooling. Production frontend dependencies, compiler, backend endpoints and trading semantics are unchanged. Do not install Blockly into production until a user-tested representation earns it.

Open questions: actual Blockly keyboard and screen-reader usability; performance/focus flicker on full rebuild; capability targeting for multiple sleeves and nested logic; conflict and undo behavior during concurrent semantic edits; dense Decision click disambiguation; Lightweight Charts attribution placement and browser marker interaction. These need targeted browser experiments, not a generic representation framework.
