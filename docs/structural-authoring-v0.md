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


## Builder shape-transformation audit

This audit is intentionally non-implementing. A transformation remains backend-owned if it is ever added; Guide and Flow must not synthesize graph topology.

| Candidate transformation | Existing valid shapes | Existing operation composition | Ownership / allocation intent | Stable surviving IDs | Validation / new semantics | Cost / MVP value | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One investment → Choose assets | Both starters exist | No; requires trailing return, rank and Top N insertion | Asset set and schedule can survive; selection defaults still require explicit product intent | Asset set, schedule, weighting and rebalance could survive | Needs a targeted Choose-template semantic operation | Medium / useful, but Creation Picker already supplies Choose assets | DEFER |
| Choose assets → filtered selection | Both shapes exist | Yes; `add_qualification_condition` is the exact supported transformation | Unambiguous for a listed rank target | All existing IDs survive; one deterministic condition ID is added | Already validated by Structural Authoring v0 | Already delivered / high | REUSE EXISTING |
| Selection → fallback selection | Both shapes exist | No; qualification, fallback asset-set intent and fallback wiring must be coordinated | Fallback destination must be chosen explicitly | Existing selection pipeline could survive | Needs a targeted fallback semantic operation and validation contract | Medium / moderate; fallback starter already exists | DEFER |
| Simple selection → Growth + Defensive | Both shapes exist | No; requires sleeves, second owned pipeline, portfolio and allocation vector | Allocation and ownership are ambiguous without explicit caller intent | Existing selection pipeline could survive, new sleeve/portfolio IDs required | Requires a new atomic portfolio-shape semantic operation | High / useful breadth, not required to complete the narrow MVP loop | DEFER |

No additional shape transformation is required for the current MVP: backend-owned starting structures already enter each supported shape, while Authoring Harvest exposes the one cheap, unambiguous transformation. Evidence Harvest should precede broader construction semantics.

## Commodity infrastructure watch

| Area | Repository evidence | Policy | Classification |
| --- | --- | --- | --- |
| Flow mechanics | The conceptual Flow still owns pointer-drag listeners and fixed canvas coordinates; `@xyflow/react` is already installed and used elsewhere | If zoom/pan, edge rendering, selection rectangles, multi-select or keyboard canvas mechanics grow, move rendering/interaction mechanics to xyflow while Canonical and the RuleTrade projection remain authoritative | ADOPT EXTERNAL |
| Result chart | The current compact SVG equity chart owns scaling, markers and keyboard activation and is adequate for MVP | If generic chart pan/zoom, axes, crosshair or rendering grows, evaluate TradingView Lightweight Charts; RuleTrade retains Decision/Evidence linkage | ADOPT EXTERNAL |
| Analytical visualizations | No sensitivity/robustness matrix exists in this increment | Evaluate ECharts only when those post-MVP surfaces exist | DEFER |
| Accessible primitives | This increment adds inline contextual controls, not a new dialog/popover/menu system | Adopt focused accessible primitives when an accessibility-heavy interaction is actually introduced; do not migrate wholesale | ADOPT EXTERNAL |
