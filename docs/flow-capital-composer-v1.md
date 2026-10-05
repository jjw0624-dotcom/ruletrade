# Flow Capital Composer v1

## Perspective contract

Canonical Strategy remains the only strategy truth. The shared semantic projection feeds two deliberately different authoring perspectives:

- **Blocky** answers which decision program executes and in what control-flow order.
- **Flow** answers where ownership, candidate sets, selected exposure, allocation targets, and conditional routes go.
- **LogicDraft** is an unfinished Blocky program.
- **FlowDraft** is an unfinished Flow topology.

Neither Blockly connections nor xyflow node/edge serialization is compiler input. Every committed edit travels through a representation-independent semantic intent, backend validation, Canonical replacement, and full reprojection.

## Flow vocabulary

Flow uses repository-native concepts:

| Flow unit | Semantic meaning |
| --- | --- |
| Portfolio | capital owner and final target context |
| Group | named asset context; not automatically a Sleeve |
| Sleeve | an owned allocation branch of a Portfolio |
| Universe | explicit or Group-derived candidates |
| Eligibility | candidate admission before Selection |
| Selection | ranking, count, shortage behavior, and fallback modifiers |
| Predicate route | actual true/false capital routing |
| Allocation | conversion of assets/selections into target weights |
| Action | application of targets, currently rebalance |
| Schedule | an attachment indicating when a subgraph is evaluated |
| Constraint | behavior such as cooldown attached to Selection |

A Flow node may aggregate several Canonical components. Inspector selection and provenance always retain the persisted component identity.

## Projection grammar

- Explicit universes show source identity, count, and compact membership.
- Eligibility is a candidate edge/node before Selection, never a portfolio false branch.
- Selection fallback is a modifier route labelled “if incomplete”; it is not Control OTHERWISE.
- Predicates render as labelled true and false routes. A missing ELSE ends in “retain current holdings”.
- Portfolio splits render parallel Sleeve branches with allocation percentages.
- Equal allocation and rebalance remain distinct units.
- Schedules attach with dashed “evaluates” relationships rather than appearing as capital.
- Cooldown attaches to Selection as a constraint rather than sitting in the capital pipeline.

Initial layout is deterministic and keyed by semantic identity. Surviving node positions are preserved across Canonical reprojection. Position, pan, zoom, and viewport remain disposable presentation state and never dirty Canonical.

## Authoring and compatibility

The Add panel presents Flow categories: Capital, Assets / universe, Decision / routing, and Timing / behavior. Recipes remain in Guide.

Safe existing operations are reused:

- ranked Selection scaffold;
- Eligibility insertion;
- Selection fallback;
- cooldown;
- two-Sleeve Split;
- explicit Universe membership and shared semantic field editors;
- allocation changes through the shared Sleeve allocation editor;
- supported modifier deletion.

Toolbox drops create a FlowDraft while configuration is incomplete. A complete, unambiguous configuration invokes the existing backend operation and automatically replaces Canonical. Direct Inspector changes use the shared Value, Condition, and Selection authoring contract from PR #38.

Connection handles expose only meaningful relationship classes. A candidate connection is first checked against the Flow view of the shared semantic compatibility contract. Invalid relationships are rejected without Canonical mutation. A meaningful connection that has no unambiguous backend operation becomes VALID_BUT_UNSUPPORTED and must be discarded or replaced by a supported scaffold; it is never serialized as Strategy truth.

## FlowDraft

Statuses:

- INCOMPLETE: a semantic unit was dropped but still needs configuration.
- VALID_BUT_UNSUPPORTED: the relationship is meaningful but no safe intent exists.
- COMMIT_READY: configuration is complete and the backend intent is being applied.
- CLEAN: Flow is a projection of committed Canonical only.

Any non-clean FlowDraft blocks Save and Test. Switching to Blocky, Rules, Code, or AI continues to show committed Canonical. Returning to Flow preserves the draft while the Builder remains mounted. Successful backend replacement clears the draft and reprojects all views.

## Shared Inspector shell

The editor drills through one semantic depth at a time:

    Selection → Condition → Comparison → one Value

A comparison renders two collapsed Value rows. Opening the left Value hides the Condition row and right Value editor; Back returns to the comparison. The same applies to the right Value. A new IF begins with neither Value editor expanded. There are no nested Close controls and no permanent “Automatic” label. Complete values continue to auto-apply; incomplete edits remain local and gate Save/Test.

The Inspector stays an overlay, so opening it never changes Flow or Blocky canvas geometry.

## Deletion and undo boundary

Eligibility, fallback, and cooldown use existing backend-owned removal operations. Other nodes cannot be deleted when removal would ambiguously destroy routing, allocation, or both branches. Those cases explain that the surrounding topology must be resolved instead of guessing an unwrap.

xyflow movement is presentation-local. Semantic edits are authoritative only after backend Canonical replacement. A presentation undo must never resurrect an older Canonical graph.

## Independent schedules and parallelism

Each Group/Sleeve schedule attaches to its own Flow subgraph. A portfolio rebalance schedule attaches to the Portfolio. Flow does not fabricate a global execution sequence. Parallel Sleeve allocations remain parallel.

## Cross-perspective round trip

    Flow gesture
    → FlowDraft if incomplete
    → semantic intent
    → backend
    → Canonical'
    → Flow + Blocky + Rules + Summary/Code/AI reprojection

The reverse path uses the same Canonical identity. Result → Decision → Evidence → View rule selects the same Predicate, Selection, or related semantic component; Flow has no separate Evidence model.

## Deliberate limits

The following remain unavailable rather than faked:

- arbitrary connect/disconnect/delete graph programming;
- generic Predicate-route creation without an unambiguous branch scaffold;
- compiler-unsupported topology;
- new indicators or expression grammar;
- Flow-owned persistence;
- Asset Workspace navigation.

Stable Universe, Group, Selection, and Predicate identities are suitable for a future Asset Workspace without coupling it to xyflow IDs.
