# 169-case Blocky architecture audit

## Existing authority and boundaries

| Surface | Actual implementation | Status for this work |
|---|---|---|
| `SemanticProgramV2` | Committed Canonical meaning, validators, reference evaluation, capability preflight, lowering | Kept authoritative; new draft grammar does not bypass it |
| Working Draft v3 | Native Blockly JSON, disconnected blocks, positions, objects, active roots, recovery | Extended only through registered typed blocks and serialized field values |
| Blockly registration | `entryStyleGrammar.ts` + `blockyProgramBlocks.ts`, native checks/flyouts/serialization | Extended with AssetSet/predicate/aggregate/random grammar |
| Active visual graph | `validateActiveVisualGraphs` and active root state | Kept; a typed draft graph is not automatically committed |
| Inspector | `blockUiContract.ts` drives advanced/capability detail | Uses the same contract for new grammar; no second input-state model |
| Group/Object Workspace | Existing reusable Group identity plus Asset Workspace | Kept; Group creation remains separate from inserting a Group reference |
| Flow / React Flow | Capital routes and layout-only state | Kept distinct: AssetSet expressions never become capital nodes on their own |
| Authoring/CAS | Typed product operations and expected-source-hash commit | No new direct mutation path |
| Reference/LEAN | Existing bounded semantic subsets and Docker differential corpus | New AssetSet/random blocks remain draft-only pending reference/lowering evidence |

## Reuse decision

- Blockly native connection checks, flyout rendering, disposal, serialization, movement and undo/redo are reused.
- Existing Blockly core Logic/Math/Control/Variables/Procedures registrations remain reused where their behavior fits.
- Existing Group Workspace and React Flow capital graph remain reused.
- The only custom work is RuleTrade-specific financial type checks and the Block UI contract metadata needed to keep per-asset predicates distinct from strategy-level truth.

## Before / after grammar boundary

Before this package, `Choose from Group` combined filtering, ranking and selection in one product block. That path remains valid for its bounded semantic subset, but it could not express Filter-only or nested anonymous AssetSet expressions without pretending every intermediate set was a persistent Group.

This package adds typed Working Draft expressions:

`Group/Subgroup → Filter → Top/Bottom/Random → set algebra → direct AssetSet target`

Candidate-scoped values produce `CandidateValue`; candidate comparisons produce `AssetPredicate`; only `Any`, `All`, or `N-of-M` produce strategy-level `Truth`. This is the necessary separation between `RSI(candidate) < 10` and `Count(Filter(group, predicate)) > 5`.

## Deliberate gaps

The grammar is not presented as a new production lowerer. In particular, random execution, options lifecycles, pair/model/fundamental contracts, event calendars, detailed execution policies, and external discretionary signals remain outside this change until their exact semantics and differential evidence are supplied.
