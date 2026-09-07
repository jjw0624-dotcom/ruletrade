# Canonical Strategy v1 Foundation

Canonical v1 is RuleTrade's single execution-semantic source of truth. Editor layout, research
annotations, and presentation metadata do not belong in this document.

## Shape

The document combines:

- typed definitions for named asset sets, parameters, and persistent state;
- a typed component graph for events, transforms, rules, allocators, and effects;
- expression and action ASTs inside rule components; and
- explicit entrypoints that connect an event to an executable component.

`Percentage` is a decimal ratio (`0.25` means 25%), `Shares` may be fractional, and `Money` is an
amount in the strategy account currency. Market `Price`/`AverageCost` expressions use the distinct
`MoneyPerShare` type, allowing dimensional checks such as `Money / MoneyPerShare -> Shares`.
Multi-currency money values and FX conversion are outside the current single-account-currency MVP.

Every primitive is versioned (`random_select@1`) and resolved through the Primitive Registry.
The registry owns port types, fields, authoring support, backend capability classification, and a
compiler implementation identifier. Compiler source code does not live in the registry.

Primitive field types, ranges, choices, defaults, and definition-reference kinds are declared once
in the registry and consumed generically by semantic validation. Runtime or compiler algorithms
remain ordinary code selected by `implementation_id`; the registry is not a template engine.

Graph connections represent only acyclic data dependencies between component ports. Event dispatch
is represented by entrypoints. Stateful feedback is represented by `StateRef` expressions and
`SetState`/`IncrementState` actions, not by a data-connection cycle. Cycle detection therefore does
not reject the supported state model; a future delayed-feedback graph feature would need an explicit
new edge/port semantic rather than silently weakening current dataflow validation.

## Validation layers

Pydantic performs structural validation. The semantic checker then verifies:

- primitive and definition references;
- required configuration and graph inputs;
- source/output and target/input port compatibility;
- event entrypoints;
- rule condition types; and
- financial units for actions such as shares, money, and target percentages.

Indicator expressions use a versioned registry ID and a generic parameter map. Adding RSI, SMA, or
another indicator registers its parameter contract and result type without changing the Canonical
schema. An unregistered indicator is semantically invalid.

The two golden fixtures cover the first migration targets:

1. Growth/Safe asset sets with deterministic per-event random selection and allocation.
2. A stateful, bounded one-share buying rule.

## Semantic identity

The v1 semantic hash excludes metadata and normalizes definition, component, connection, and
entrypoint ordering. Stable component IDs are still part of v1 identity because graph references
depend on them. A future graph-isomorphism-aware hash can replace this implementation behind the
same `strategy_hash` abstraction without changing editor documents.

Random selection seed material is derived from the strategy semantic hash, the component stable ID,
parameter bindings, and—only for `per_event`—the event identity. The Canonical `random_seed` is part
of the semantic hash. This gives Python reference semantics and future generated C# the same portable
seed contract while preserving `once` behavior across events.

## Deliberately deferred

This foundation does not execute v1 documents. Composite expansion, typed `LeanPlan`, C# code
generation, Roslyn compilation, UI projections, persistence, and revision history belong to later
vertical slices. Strategy Core v0 remains available as a reference semantics oracle during that
migration.
