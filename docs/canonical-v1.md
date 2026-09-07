# Canonical Strategy v1 Foundation

Canonical v1 is RuleTrade's single execution-semantic source of truth. Editor layout, research
annotations, and presentation metadata do not belong in this document.

## Shape

The document combines:

- typed definitions for named asset sets, parameters, and persistent state;
- a typed component graph for events, transforms, rules, allocators, and effects;
- expression and action ASTs inside rule components; and
- explicit entrypoints that connect an event to an executable component.

Every primitive is versioned (`random_select@1`) and resolved through the Primitive Registry.
The registry owns port types, fields, authoring support, backend capability classification, and a
compiler implementation identifier. Compiler source code does not live in the registry.

## Validation layers

Pydantic performs structural validation. The semantic checker then verifies:

- primitive and definition references;
- required configuration and graph inputs;
- source/output and target/input port compatibility;
- event entrypoints;
- rule condition types; and
- financial units for actions such as shares, money, and target percentages.

The two golden fixtures cover the first migration targets:

1. Growth/Safe asset sets with deterministic per-event random selection and allocation.
2. A stateful, bounded one-share buying rule.

## Semantic identity

The v1 semantic hash excludes metadata and normalizes definition, component, connection, and
entrypoint ordering. Stable component IDs are still part of v1 identity because graph references
depend on them. A future graph-isomorphism-aware hash can replace this implementation behind the
same `strategy_hash` abstraction without changing editor documents.

## Deliberately deferred

This foundation does not execute v1 documents. Composite expansion, typed `LeanPlan`, C# code
generation, Roslyn compilation, UI projections, persistence, and revision history belong to later
vertical slices. Strategy Core v0 remains available as a reference semantics oracle during that
migration.
