# Composer UX v1

**Status: MVP 1 implementation.**

Flow and Blocky are direct-manipulation perspectives over the same Canonical Strategy. They do not own semantic graph state. A palette or Blockly gesture produces one explicit `compose_strategy` batch, the backend validates the complete graph atomically, and every representation reprojects from the returned Canonical document.

The fixed RuleTrade **Add** panel is the semantic component library for both
perspectives. Library membership comes from the executable Registry vocabulary
and remains visible independently of whether the current Strategy has a legal
insertion target. Each concept is classified as available now, needing a
compatible context, currently unavailable because no safe semantic insertion
operation exists, or unsupported by the current composition grammar. Disabled
concepts explain the boundary and cannot mutate Canonical.

Flow does not present shape-conversion recipes as its primary vocabulary, and
Blocky does not mount a competing Blockly flyout. Flow exposes Investment,
Split, Sleeve, Allocation, Asset Set, Metric, Condition, Rank, Choose,
Fallback, Cooldown, and Schedule where those concepts exist in the Registry.
Blocky uses the logic subset: Asset Set, Metric, Condition, Rank, Choose,
Fallback, Cooldown, and Schedule. Availability is separate from visibility and
legality.
Guide retains high-level recipes because guided intent and primitive composition
are different interaction jobs.

## Current composition proofs

- **Decision pipeline:** a Condition can be dragged or added between the exact score producer and Rank input. The batch disconnects the existing edge, creates `filter@1`, and reconnects both sides atomically.
- **Portfolio topology:** Add Split creates the smallest valid two-sleeve scaffold from asset-set, allocator, sleeve, and portfolio primitives with request-local references. Backend-owned IDs from the response drive semantic selection. "Growth + Defensive" is an example result/Guide recipe, not a fundamental Strategy type.
- **Cross-perspective:** Flow composition appears in Blocky, Rules, Guide, and Summary through normal projection; supported Blocky field edits use the existing authoring contract and reproject Flow.

Blockly and xyflow retain presentation-only positions, selection decoration, pan, and zoom. Their IDs and serialization are disposable. Canonical `component_id` plus optional `field_path` remains semantic identity.

With the shared library outside the representation, all remaining Blocky area
belongs to the Blockly canvas. Authoring forms and errors appear only as
contextual overlays; there is no permanent instruction footer or duplicate
semantic toolbox.

## Boundary

Composer v1 does not enable arbitrary wiring, incomplete persisted graphs, generic N-sleeve portfolios, nested groups, or expression trees. Composition uses **Option A: atomic valid scaffolds**; no draft or incomplete Canonical is introduced. High-level recipes remain available in Guide where they collect intent more safely. Backend capabilities decide which compositional concepts are exposed, and rejection leaves Canonical unchanged.
