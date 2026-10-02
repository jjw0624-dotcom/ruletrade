# Typed control-branch semantic compatibility

Predicate v1 uses a representation-independent statement/effect contract below
Canonical and above Blocky or Flow projection mechanics.

| Family | Control branch | Consumes | Produces |
|---|---|---|---|
| Selection | supported | none | candidates |
| Allocation | supported | candidates | targets |
| Action / Rebalance | supported | targets | execution |
| Constraint | draftable only | candidates | candidates |
| Timing / Trigger | invalid | none | none |
| nested Control | draftable only | none | execution |
| Selection fallback | invalid as a branch statement | candidates | candidates |

A branch is commit-ready only when every connection is compatible and its final
effect is execution. Timing remains Script-level. Selection fallback remains a
Selection modifier and is not Control OTHERWISE. Nested Control is intentionally
draftable-only for this PR.

Blocky uses the contract to classify its working topology. Future Flow authoring
may use the same consumes/produces information to validate ports, while retaining
its own capital-routing projection and interaction grammar.
