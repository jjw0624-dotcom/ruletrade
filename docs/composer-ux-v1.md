# Composer UX v1

**Status: MVP 1 implementation.**

Flow and Blocky are direct-manipulation perspectives over the same Canonical Strategy. They do not own semantic graph state. A palette or Blockly gesture produces one explicit `compose_strategy` batch, the backend validates the complete graph atomically, and every representation reprojects from the returned Canonical document.

## Current composition proofs

- **Decision pipeline:** a Condition can be dragged or added between the exact score producer and Rank input. The batch disconnects the existing edge, creates `filter@1`, and reconnects both sides atomically.
- **Portfolio topology:** the supported two-sleeve portfolio is assembled from asset-set, allocator, sleeve, and portfolio primitives with request-local references. Backend-owned IDs from the response drive semantic selection.
- **Cross-perspective:** Flow composition appears in Blocky, Rules, Guide, and Summary through normal projection; supported Blocky field edits use the existing authoring contract and reproject Flow.

Blockly and xyflow retain presentation-only positions, selection decoration, pan, and zoom. Their IDs and serialization are disposable. Canonical `component_id` plus optional `field_path` remains semantic identity.

## Boundary

Composer v1 does not enable arbitrary wiring, incomplete persisted graphs, generic N-sleeve portfolios, nested groups, or expression trees. Existing high-level Choose, Fallback, Cooldown, and Growth + Defensive recipes remain available where they collect intent more safely. Backend capabilities decide which compositional concepts are exposed, and rejection leaves Canonical unchanged.
