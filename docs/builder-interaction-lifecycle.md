# Builder interaction lifecycle

| Action | Transaction owner | Commit point | Cancel / failure | Persistence |
|---|---|---|---|---|
| Create Group | Object Library + Group Workspace | validated `addGroup` semantic operation | no object and no visual reference | Canonical after CAS |
| Create Group for slot | Group Workspace, then Blockly | Group CAS plus explicit native reference insertion | original empty slot and graph remain | Canonical definition + Working Draft reference |
| Drag block from Add | Blockly gesture | native block create event | Blockly cancels gesture; no React fallback drop | native workspace JSON |
| Connect/disconnect draft | Blockly | active-graph commit is separate | disconnected fragments remain | native workspace JSON |
| Delete draft block | Blockly | native disposal event | Blockly undo restores | native workspace JSON |
| Move/collapse/pan Blocky | Blockly | none; layout-only | native undo/redo | native workspace JSON/viewport |
| Move/pan Flow | React Flow | none; layout-only | Flow state remains independent | Working Draft Flow fields |
| Inspector parameter edit | native field API or typed semantic operation | native event or CAS response | failed CAS cannot replace newer response | native workspace or Canonical |
| Perspective switch | shared shell | none | mounted workspace remains intact | current visual states remain owned locally |
| Save | revision service | successful source-hash CAS/revision | dirty Canonical and recoverable draft remain | Strategy revision + local draft |
| Reopen | editor hydration | successful Canonical and draft load | incompatible draft migrates or safely resets | revision + Working Draft v3 |

## Ordering

Backend authoring requests use a monotonically increasing sequence; stale responses are ignored. Blockly snapshots are persistence observations, not instructions to reconstruct native draft connections. Canonical projection reconciliation may add/update immutable committed blocks but cannot delete unrelated `draft:*` blocks.

## Undo scopes

Blockly native undo/redo has priority while Blocky is active. Flow layout history is Working Draft-only. Canonical undo/redo produces explicit authoring operations and remains separate from visual history.
