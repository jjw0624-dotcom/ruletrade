# Composer UX v1

**Status: MVP 1 implementation.**

Flow and Blocky are direct-manipulation perspectives over the same Canonical Strategy. They do not own semantic graph state. A palette or Blockly gesture produces one explicit `compose_strategy` batch, the backend validates the complete graph atomically, and every representation reprojects from the returned Canonical document.

The fixed RuleTrade **Add** panel is the semantic toolbox for both perspectives.
Flow does not present shape-conversion recipes as its primary vocabulary, and
Blocky does not mount a competing Blockly flyout. The current executable
vocabulary is capability-derived and includes Choose, Condition, Fallback,
Cooldown, and a portfolio Split scaffold where the current Strategy is eligible.
Guide retains high-level recipes because guided intent and primitive composition
are different interaction jobs.

## Current composition proofs

- **Decision pipeline:** a Condition can be dragged or added between the exact score producer and Rank input. The batch disconnects the existing edge, creates `filter@1`, and reconnects both sides atomically.
- **Portfolio topology:** Add Split creates the smallest valid two-sleeve scaffold from asset-set, allocator, sleeve, and portfolio primitives with request-local references. Backend-owned IDs from the response drive semantic selection. "Growth + Defensive" is an example result/Guide recipe, not a fundamental Strategy type.
- **Cross-perspective:** Flow composition appears in Blocky, Rules, Guide, and Summary through normal projection; supported Blocky field edits use the existing authoring contract and reproject Flow.

Blockly and xyflow retain presentation-only positions, selection decoration, pan, and zoom. Their IDs and serialization are disposable. Canonical `component_id` plus optional `field_path` remains semantic identity.

## Boundary

Composer v1 does not enable arbitrary wiring, incomplete persisted graphs, generic N-sleeve portfolios, nested groups, or expression trees. Composition uses **Option A: atomic valid scaffolds**; no draft or incomplete Canonical is introduced. High-level recipes remain available in Guide where they collect intent more safely. Backend capabilities decide which compositional concepts are exposed, and rejection leaves Canonical unchanged.
