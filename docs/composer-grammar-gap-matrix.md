# Composer grammar gap matrix

Status: **MVP 1 / current**. This document records the production grammar; it is not a future universal graph-editor design.

The Composer always submits semantic intent through the backend Authoring Contract. Generic composition validates typed ports and the complete resulting Canonical atomically. Intermediate invalid graphs are not working state.

| Concept | Registry / executable | Generic create | Field edit | Typed connect | Safe remove | Flow | Blocky | Production create gesture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Investment | Executable shape, not one primitive | No standalone object | Assets/schedule through owned parts | Through its parts | No | Read/edit | Read/edit | Starter or Split scaffold only |
| Asset Set | Yes | Yes, inside a valid batch | Yes | `assets` output | Only in a valid atomic batch | Yes | Yes | Created as required scaffold support; standalone insertion deferred |
| Metric / trailing return | Yes | Yes | Lookback | `assets → scores` | Only in a valid atomic batch | Yes | Yes | **Add Metric pipeline** on a direct investment |
| Condition | Yes | Yes | Threshold | `scores → scores` | Yes, unambiguous splice inverse | Yes | Yes | Independent Add after Metric |
| Rank | Yes | Yes | Direction is fixed for MVP 1 | `scores → ranked` | No standalone inverse | Yes | Yes | Minimum support created with Metric; standalone insertion deferred |
| Choose / Top N | Yes | Yes | Count | `ranked → selected` | No standalone inverse | Yes | Yes | Minimum support created with Metric; legacy high-level Choose action remains |
| Fallback | Yes | Yes, inside a valid batch | Fallback asset set | Selection routing | Yes | Yes | Yes | Independent Add after a qualifying selection |
| Cooldown | Yes | Yes, inside a valid batch | Duration | Selection routing | Yes | Yes | Yes | Independent Add after Choose |
| Allocation / equal weight | Yes | Yes, inside a valid batch | Sleeve allocation where applicable | `assets → targets` | Only in a valid atomic batch | Yes | Context only | Created by starter/Split; direct standalone insertion deferred |
| Split | Executable portfolio topology, not one primitive | Atomic multi-primitive batch | Sleeve allocations | Typed sleeve contributions | No generic inverse | Yes | Grouped logic | **Add Split** minimum two-sleeve scaffold |
| Sleeve | Yes | Yes, inside a valid batch | Name/allocation | `local_targets → contribution` | Only in a valid atomic batch | Yes | Yes | Created by Split; unrestricted N-sleeve insertion deferred |
| Portfolio | Yes | Yes, inside a valid batch | No current direct field operation | `sleeves → targets` | No | Yes | Yes | Created by Split scaffold |
| Schedule | Yes | Event creation intentionally unavailable | Yes | Entrypoint-owned, not a graph port gesture | No | Yes | Yes | Creation deferred; existing schedule is editable |
| Rebalance | Yes | Effect creation intentionally unavailable | No | Receives targets | No | Yes | Not a logic step | Created by supported starters only |

## Valid incremental construction path

From a direct one-investment Strategy:

1. **Add Metric pipeline** creates trailing return plus only the Rank and Choose components required to keep the returned Canonical executable.
2. **Add Condition** is a separate typed score-pipeline splice.
3. **Add Cooldown** is a separate selection operation.
4. **Add Fallback** becomes available only when the filtered-selection topology supports it. Under the current executable grammar, Fallback and Cooldown are alternative routing shapes rather than composable siblings; remove Cooldown before adding Fallback.
5. Condition, Cooldown, and Fallback each retain their supported Inspector removal and can be re-added.

The scaffold is explicit in the UI. It is not represented as three independently persisted invalid nodes and it is not a hidden frontend graph mutation.

## Exact MVP 1 breakpoints

- Generic create/connect/disconnect is backend-supported, but every request must end in a valid executable Canonical.
- The Composer does not store incomplete graph drafts.
- Rank and Choose cannot be inserted as disconnected standalone nodes; their minimum valid context is created with Metric.
- Asset Set, Allocation, Sleeve, and Portfolio are directly manipulable after a valid starter/Split scaffold, but do not yet have unrestricted standalone insertion gestures.
- Schedule and Rebalance creation remain unavailable because event/effect ownership is outside generic component creation.
- Arbitrary wiring, arbitrary Blockly programs, generic AND/OR trees, unrestricted nested or N-sleeve portfolios, and new trading semantics are deferred.

Guide continues to own named Strategy recipes. Flow and Blocky expose semantic concepts and legal insertion contexts; neither editor serialization is Strategy truth.
