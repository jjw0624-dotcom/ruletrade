# Semantic projection contracts

`strategy/v2/projections.py` defines UI-independent manifests. They are derived
from `CanonicalStrategyV2` and are never persisted or accepted as mutation input.
Every item carries a stable semantic address and deterministic order.

## Shared invariants

1. Canonical semantic IDs and definition IDs are the identity source; array index
   is path context, not identity.
2. A projection may omit detail but cannot invent a route, rule, state, or
   execution capability.
3. Invalid Canonical semantics are reported by `semantic_valid`; rendering a
   manifest does not require production lowering, provider access, or Docker.
4. Editing intent maps back through `InspectorAddressManifest` to a registered
   semantic operation. A representation is never an authoring authority.
5. Ordering is Canonical Program order except where a view explicitly groups
   ownership or capital routes.

## View contracts

| View | Includes | Omits / compresses | Ordering and grouping |
|---|---|---|---|
| Structure | Portfolio ownership, Investments, Assets, Qualification, Selection, fallback, rebalance clocks | mathematical operator internals and execution diagnostics | definition order, then product ownership order |
| Flow | capital source, Investments, Selection, selected/fallback destinations, reconverging rebalance action | indicator calculations and Condition internals | topological capital order; route kind is explicit |
| Blocky | Program statement order, nested branches/actions, Conditions, ranking Values, Events, State, memory | portfolio decoration and runtime/provider state | lexical Program order; nested statement parentage preserved |
| Rules | readable ordered statement clauses | visual containment and execution diagnostics | executable statement order |
| Summary | name and essential product intent | operator internals, full rule order, runtime availability | one concise strategy-level item |

Flow and Blocky are intentionally different. Flow answers where capital can go;
Blocky answers how decisions and actions are computed. Structure cannot be
serialized into Blocky as a substitute for Program semantics.

## Semantic addresses and editing intent

An address records `kind`, `semantic_id`, and diagnostic `canonical_path`.
`InspectorAddressManifest` registers valid operations by semantic role, for
example Selection assets/eligibility/ranking/fallback and Allocation replacement.
Unregistered roles are explicitly read-only; a client must not discover support
by submitting an invalid mutation.

## Unsupported and invalid behavior

- Unsupported execution does not prevent projection.
- Provider or runtime unavailability does not alter projection meaning.
- Unresolved semantic statements remain visible as unresolved Blocky/Rules
  items; they are never summarized as executable behavior.
- Unknown is preserved in rule semantics and is not rewritten as False.
