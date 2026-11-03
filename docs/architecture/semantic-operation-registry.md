# Semantic operation registry

Audited commit: `5ceaeda56bbe5012bf755d28c580dc848814492c`. Exact 44-operation list: [semantic-operation-registry.json](semantic-operation-registry.json).

## Atomic boundary

Every committed V2 mutation uses `ApplyV2AuthoringRequest(strategy, expected_source_hash, operation)`. `apply_v2_authoring_operation()` verifies the hash, validates preconditions and the complete candidate, and returns a complete Canonical replacement plus new hash. Saving then creates a Revision with parent CAS. Failure leaves Canonical unchanged; incomplete UI input remains in its perspective draft.

| Family | Operations | Preconditions / affected meaning | Callers and effect |
|---|---|---|---|
| Selection compatibility | `set_selection_*`, `set_eligibility_condition`, `set_ranking_*`, `set_predicate` | compatibility Selection present and typed | compatibility Inspector; Canonical mutation |
| Program structure | set/insert/replace/remove/move statement | Program-native strategy, valid parent/branch/address | internal/advanced adapters; broad Canonical mutation |
| Definitions/Objects | asset set, add/rename/remove Group, rename Subgroup | unique IDs; dependency checks | Object/Group Workspace; no visual block insertion |
| Choose | create/set/remove Selection/Choose; fallback | Group/domain, clock, typed ranking/count | Inspector/Builder; membership only |
| Capital | add/remove Investment, set allocation, split | explicit target, clock and allocation policy | Flow/Inspector/intent adapters; exposure meaning |
| Temporal | schedule, event/state transaction, condition/value/event/transition setters | declared clocks/keys and typed expressions | Inspector and atomic intent paths |
| Complete intents | single asset, regime, split, weighted score, temporal, multi-clock | all required parameters supplied | product intent authoring; one validated transaction |
| Formalization | set provenance, formalize statement/phrase | explicit interpretation and replacement | guided formalization; unresolved never executes |

## Nonsemantic operations

Blockly drag/connect/dispose/undo, React Flow drag/pan, disclosure, selected block, Inspector visibility and Quick Test inputs do not use semantic CAS because they do not modify committed meaning. Their correct persistence target is Working Draft or Run configuration.

## Important non-equivalences

- `create_program_choose` creates dynamic membership only; it cannot allocate capital.
- `set_program_investment` commits exposure; it cannot stand in for fixed-money Buy.
- `add_program_group` defines an object; it cannot insert a Group-reference block.
- `set_program_fallback` is Selection shortage behavior, not `control.otherwise`.
- `set_semantic_program` is a broad internal replacement operation and should not be exposed as a casual UI gesture.

No operation intentionally bypasses source-hash CAS at the backend apply boundary. The open gap is coverage: not every visually draftable block or Flow edit has a proven typed compiler/operation path.
