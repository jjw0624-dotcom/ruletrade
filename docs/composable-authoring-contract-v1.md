# Composable Authoring Contract v1

**Status: MVP 1 foundation.**

RuleTrade owns Strategy meaning. Editors may own drag, drop, layout, selection decoration, and viewport mechanics, but every semantic construction gesture resolves to one backend operation and an authoritative returned Canonical Strategy.

## Contract

`compose_strategy` is an atomic batch of explicit semantic mutations:

- create an eligible registered component or asset-set definition;
- set a registered component field;
- connect or disconnect named, typed ports;
- remove a component and its incident connections.

The backend allocates Canonical IDs, checks port types and cardinality, validates the completed Canonical graph, and returns both the Canonical replacement and the IDs allocated for request-local references. An invalid batch returns no replacement; the original Strategy remains unchanged. Intermediate invalid graphs are never stored or exposed.

Capabilities are registry-derived and mark non-composable primitives explicitly. Event/entrypoint ownership, execution effects, and expression rules remain recipe-authored. This contract does not provide generic graph CRUD or permission for arbitrary wiring.

## Editor lifecycle

1. A representation reads Registry metadata and authoring capabilities.
2. A gesture produces semantic intent using Canonical component IDs and named ports.
3. The backend applies the complete batch or rejects it atomically.
4. Every representation reprojects from the returned Canonical Strategy.

Blockly workspace JSON, xyflow node IDs, positions, and editor serialization remain presentation state. Canonical `component_id` plus optional `field_path` remains the shared semantic address.

## Current boundary

The contract composes only primitives already supported by Registry validation and the maintained compiler path. It does not add trading semantics, arbitrary expression trees, unrestricted sleeves, a universal representation AST, or frontend-owned validity rules.
