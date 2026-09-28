# Blocky Program Composer v1

Status: **MVP 1 / CURRENT**

Blocky is RuleTrade's editable decision-program perspective. It derives a
representation-specific program from the headless Semantic Composition
Projection:

```text
Context / Object
  -> 0..N Scripts
     -> Trigger
        -> ordered Statements
```

Canonical Strategy remains the only persisted semantic truth. Blockly owns
drag, selection, statement-container, pan, zoom, scroll, and presentation
position mechanics. Its workspace serialization is disposable and is never a
Revision, compiler input, Test input, or Evidence identity.

## Production grammar

- A **Context** is a Canonical-backed portfolio, sleeve, investment, or asset
  execution scope. Parallel sleeves are separate contexts, not fake sequential
  statements.
- A **Script** belongs to one Context. Independent Canonical entrypoints remain
  independent scripts; their relative XY positions do not imply execution
  order.
- A **Trigger** is the existing daily, monthly, or quarterly Timing semantic.
  It starts a Script and has no previous-statement connector.
- A **Selection** is a user-level aggregate such as “Choose 2 strongest
  assets.” Its projection reference retains the primary Top N component and
  related Universe, Measure, Eligibility, and Rank component IDs.
- **Allocation** and **Action** remain distinct statements. Multiple
  simultaneous allocations are presented as one compound allocation rather
  than misleading sequential writes.
- **Cooldown** is a Constraint attached to Selection. It is not projected as a
  subsequent action.

Detailed Universe membership, lookback, ordering, count, qualification,
fallback, allocation, Timing, and Constraint fields belong primarily in the
shared Inspector.

## Eligibility, Predicate, and fallback

Eligibility answers whether an individual candidate may enter a Selection. It
is nested in the Selection visual and does not create an IF block.

A Predicate controls whether a branch of statements executes. Existing
Canonical predicates project as a Blockly IF statement container with their
supported action statements nested in the branch.

Selection fallback answers what Selection does when too few candidates
qualify. It is a Selection modifier with an explicit incomplete-selection
reason. It is not a generic control `OTHERWISE` branch.

Generic new Predicate authoring is not executable in the current MVP grammar.
The program toolbox therefore offers IF / Otherwise as an explicit
Blocky-local draft, never as an approximation of Eligibility or fallback.

## LogicDraft boundary

`LogicDraft` is the smallest representation-local state required for an
unfinished IF / Otherwise gesture. It has a temporary `draftId`, a predicate
summary, and Blockly branch topology. It is not projected into Flow, Rules,
Guide, Summary, Code, or AI.

An unresolved draft:

- survives representation switching and returns when Blocky is reopened;
- blocks Save and Test with an explicit message;
- may be discarded without changing Canonical;
- never receives persisted Evidence identity.

There is currently no generic draft-to-Canonical Predicate commit because the
backend deliberately rejects new generic predicate authoring. Future support
must add a concrete semantic intent and then follow the normal authoritative
loop:

```text
Blocky gesture
  -> semantic intent
  -> backend authoring/composition validation
  -> returned Canonical
  -> Semantic Composition Projection
  -> Blockly reconciliation
```

Committed field edits and supported Selection/fallback/Constraint construction
already follow that loop. A rejection leaves the prior Canonical authoritative
and the program reprojects from it.

## Toolbox and canvas

The Blocky Add panel is the user program language, not the Primitive Registry:

- Control: If / Otherwise (draft-only)
- Selection: Choose assets; Eligibility
- Action: Allocate
- Timing: Schedule
- Behavior: Selection fallback; Constraint

Entries remain visible as available, draftable, existing/focus, or unsupported.
Flow-only Split recipes are not Blocky statements. Guide continues to own
high-level recipes.

After the fixed left panel, all remaining representation area is Blockly
canvas. No permanent heading, footer, or instruction row consumes canvas
space. Contexts and whole Scripts may move as presentation state. Committed
statement order is constrained when current Canonical does not expose a safe
reorder operation.

## Current limits

MVP 1 does not add generic predicates, recursive AND/OR expressions, arbitrary
statement reorder, arbitrary Blockly programs, generic Buy/Sell operations,
new indicators, or Flow Capital Composer. Blocky exposes only the executable
Canonical grammar and one visibly non-authoritative control draft.
