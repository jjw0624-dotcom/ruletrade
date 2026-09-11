# Structural Authoring v0

Structural authoring is stateless: `CanonicalStrategyV1 -> semantic operation -> new CanonicalStrategyV1 -> validation`. The API neither saves a Revision nor runs LEAN. Callers ask `POST /v1/canonical/strategies/authoring/capabilities`, then use `POST /v1/canonical/strategies/authoring/apply`. Guide and Flow never create primitives or connections.

## Capability audit

| Operation | Canonical | Existing edit | Mutation | v0 |
| --- | --- | --- | --- | --- |
| Rename group | sleeve name config | Generic field | One component | Supported semantically |
| Add group | sleeve, owned pipeline, allocation | No | Coordinated graph | Blocked: portfolio v0 requires exactly two sleeves and no intent-free default |
| Remove group | sleeve, pipeline, schedule, references | No | Coordinated graph | Blocked by exact-two invariant and ambiguous ownership |
| Add qualification | filter between return and rank | No | Component + connections | Supported for unfiltered return/rank |
| Remove qualification | bypass filter | No | Component + reconnection | Supported when validation accepts the result |
| Multiple conditions | multiple filters | No | Coordinated graph | Deferred: combination meaning is undefined |
| Create Choose | universe through allocation | No | Full template | Deferred: starting structures already provide Choose |
| Existing assets/parameters/schedules/allocation | definitions/config | Yes | Existing patches | Preserved, not duplicated |

Only compiler-supported strict trailing-return `gt` is created. Broader expression types do not become features.

## Safety and identity

Every operation returns a new model and runs authoritative validation. Surviving IDs remain stable. A new condition deterministically uses `<rank id>_qualification`. Removal requires the exact trailing-return -> filter -> rank shape. Fallback v0 requires filtered Top N, so its filter cannot be removed. Rename changes domain metadata, not sleeve identity. New filter IDs flow through the official compiler and existing Decision Evidence provenance.

## Guide / Flow readiness

| Surface | Supported | Deferred |
| --- | --- | --- |
| Guide | Rename listed groups; add/remove listed qualification | Group add/remove |
| Flow | Rename selected Group; add/remove qualification in Choose | Group/Choose creation |
| Flow graph | None | Primitive CRUD and edge reconnection |

One investment retains current edits. Choose assets can add/remove one condition. Split portfolio can rename groups. The largest blocker is variable portfolio cardinality plus explicit component ownership; without it Group CRUD would invent allocation intent or risk deleting shared structure.
