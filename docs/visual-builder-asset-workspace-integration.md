# Visual Builder and Asset Workspace integration

## Dependency and scope

This work is stacked directly on the Builder foundation reset. It keeps `SemanticProgramV2`, Working Draft v3, CAS authoring, execution capability preflight, Flow capital projection, and maintained lowering unchanged.

The supplied `image(20261025-102437).png` is the design direction. The three later screenshots are treated as before-state evidence, not target designs.

## Before / after

| Area | Before-state defect | Integrated responsibility |
|---|---|---|
| Add | The native Blockly toolbox rendered as a second panel beside Structure/Objects and reduced the useful canvas. | Structure, Add, and Objects remain one left surface. Add reveals the native Blockly category toolbox; its compact flyout expands over the canvas without resizing the workbench. |
| Group Workspace | The Blockly toolbox remained above the modal and clipped the Group editor. | A dedicated full Builder workspace suspends toolbox/flyout hit testing until close or cancel. |
| Asset discovery | Search, results, details, and selected membership were stacked in a narrow editor. | Four bounded areas expose supported filters, sortable catalog results, point-in-time chart/metrics, and a temporary selection basket. |
| Group lifecycle | Group definition and reference insertion were visually easy to conflate. | Saving a Group remains an Object Library operation. Only explicit flyout drag, Object insertion, or compatible-slot continuation creates a Blockly reference. |
| Expressions | Large defaults obscured nesting, indicator identity, and currency meaning. | Compact Blockly theme/zoom, a reusable visible indicator block, and typed USD/KRW money fields retain essential meaning on-canvas. |

## State and transaction boundaries

- The Asset Workspace basket is temporary React workspace state.
- `Use selected assets` updates the Group draft only.
- `Create Group` commits one typed semantic operation.
- Cancel discards the current Group draft and basket while preserving Blockly JSON, block identity, connections, viewport, unrelated objects, and Canonical.
- Group identity is the stable semantic ID. Display names are never used to reconnect a slot.
- Native Blockly remains authoritative for block geometry, typed connections, drag, disposal, serialization, and undo/redo.

## Provider truth

The maintained catalog currently supplies ticker, name, instrument type, availability range/status, adjusted prices, and bounded derived metrics. Filters requiring exchange, market, sector, fundamentals, volume, dividends, or volatility are shown disabled and identified as unavailable. No substitute or fabricated data is used.

## Execution boundaries

Visual availability is not execution support. Fixed money, quantity, generic RSI/EMA authoring, signal delivery, loops, waits, random values, and function execution remain draft-only unless their existing capability records say otherwise. Currency is preserved as typed draft intent; no FX conversion is inferred. Flow continues to show capital routing only.

## Browser evidence

`scripts/check_builder_browser.mjs` drives installed Google Chrome through the maintained Chrome DevTools Protocol against a real Vite-rendered production Builder component. It validates 1366×768, 1440×900, and 1920×1080 geometry, native flyout drag, Group Workspace toolbox suspension, selection basket presence, and cancellation restoration. CI uploads screenshots and the CDP interaction trace from `build/browser-acceptance/`.

The harness mocks only the HTTP asset catalog boundary with the same response contracts; Blockly, React, CSS layout, Lightweight Charts, Working Draft, and the production Builder components are real.
