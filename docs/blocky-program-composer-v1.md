# Blocky Program Composer v1

Status: **MVP 1 / CURRENT**

Blocky is RuleTrade's editable decision-program perspective. It derives a
representation-specific program from the headless Semantic Composition
Projection:

```text
Canonical
  -> LogicSemanticProjection
     -> Blockly Working Program
        -> presentation edit: no semantic effect
        -> structural edit: LogicDraft
           -> commit-ready?
              -> no: keep unfinished working program
              -> yes: semantic intent -> backend -> Canonical replacement
```

Canonical Strategy remains the only persisted semantic truth. Blockly owns
drag, insertion markers, compatible connections, snapping, nesting,
detachment, trash/delete, selection, keyboard history, pan, zoom, scroll, and
position mechanics. RuleTrade does not implement a parallel drag or undo
engine. Blockly serialization is disposable and is never a Revision, compiler
input, Test input, or Evidence identity.

## Production grammar

- A **Context** is a Canonical-backed portfolio, sleeve, investment, or asset
  execution scope. Parallel sleeves are separate contexts, not fake sequential
  statements.
- A **Script** belongs to one Context. Independent Canonical entrypoints remain
  independent scripts; their relative XY positions do not imply order.
- A **Trigger** is the existing daily, monthly, or quarterly Timing semantic.
- A **Selection** is a user aggregate such as “Choose 2 strongest assets.” Its
  projection retains Top N plus related Universe, Measure, Eligibility, and
  Rank provenance.
- **Allocation** and **Action** remain distinct statements. Multiple
  simultaneous allocations are one compound allocation, not sequential
  writes.
- **Cooldown** is a Constraint attached to Selection, not a subsequent action.

Projected Trigger, Selection, Allocation, Action, and Control statements and
new draft Controls share native Blockly statement connections. They support
native insertion, detachment, nesting, reconnection, and deletion. Detailed
Universe membership, lookback, ordering, count, qualification, fallback,
allocation, Timing, and Constraint fields belong primarily in Inspector.

## Eligibility, Predicate, and fallback

Eligibility answers whether a candidate may enter a Selection. It stays nested
inside Selection and does not become IF. A Predicate controls whether a branch
of statements executes. Existing Canonical predicates project as Blockly
control containers.

Selection fallback answers what Selection does when too few candidates
qualify. It remains an explicit incomplete-selection modifier and is not a
generic `OTHERWISE` branch.

Generic Predicate authoring is not executable in the current grammar. The
toolbox offers separate IF and IF / Otherwise controls as Blocky-local drafts.
Operations remain orthogonal: there are no “conditional Choose”, “fallback
Choose”, or other combinatorial variants.

## LogicDraft working-program boundary

`LogicDraft` is Blocky's local semantic working-program state for structural
edits which Canonical has not accepted. It records stable working identities
and actual Blockly topology for add, remove, detach, insert, reorder, nest,
unnest, and branch-membership changes. Internal draft IDs are not shown as
product language; users see one state: **Unfinished Blocky changes**.

XY movement of independent Contexts/Scripts, pan, zoom, viewport, and visual
arrangement are presentation state. They do not enter the semantic snapshot
and cannot dirty Canonical. Connection topology does.

A working program is classified narrowly as clean, incomplete,
valid-but-unsupported, or commit-ready. The current backend has no executable
generic Predicate or statement-order intent, so those structural drafts remain
incomplete or valid-but-unsupported rather than being approximated. They block
Save/Test, survive representation switching, and may be restored to the
Canonical projection without changing Canonical. Other representations keep
showing authoritative Canonical.

Committed field edits and supported Selection/fallback/Constraint construction
continue through backend authoring. Generic topology does not auto-commit in
v1. Rejection leaves prior Canonical authoritative.

## Reconciliation and history

Adding a draft block is incremental: it never clears or reloads the workspace,
so existing connections and independent Script positions survive. An
authoritative Canonical replacement is a reconciliation boundary. Surviving
top-level working identities retain positions where practical; invalid old
topology yields to Canonical; Blockly undo history is cleared so it cannot
resurrect pre-commit semantics.

Within a working session Blockly owns undo/redo. `Ctrl/Cmd+Z` invokes undo;
`Ctrl/Cmd+Shift+Z` and `Ctrl+Y` invoke redo through Blockly's registered
shortcuts. RuleTrade adds no history implementation. This history is not
Strategy Revision history.

## Toolbox, deletion, and canvas

The Blocky Add panel is the user program language, not the Primitive Registry:

- Control: If; If / Otherwise (draft-only)
- Selection: Choose assets; Eligibility
- Action: Allocate
- Timing: Schedule
- Behavior: Selection fallback; Constraint

Entries remain visible as available, draftable, existing/focus, or unsupported.
Flow-only Split recipes are not Blocky statements; Guide owns recipes. After
the fixed left panel, all remaining space is Blockly canvas. The production
toolbox uses a compact category rail and an independently scrolling block
library. Dragging a draft Control into the workspace places a native Blockly
block at the drop location; clicking remains the keyboard/accessibility
fallback. The fixed RuleTrade panel is the only semantic library, so Blockly
does not mount a duplicate flyout.

Blockly's native click event, rather than its lower-level selection event,
opens Inspector. A drag may select a block internally but does not open a
newly closed Inspector. Inspector, draft state, validation, and contextual
errors are overlays: appearing or disappearing does not resize the Blockly
world. Save and Test remain disabled while the local topology is unresolved.

Blockly trash/context menu/keyboard delete are the primary canvas deletion
mechanics. Inspector provides contextual semantic removal and draft discard.
The left panel remains construction-oriented rather than introducing a second
drag/delete engine. Blockly's built-in trashcan is the native drag deletion
target; making the fixed RuleTrade Add panel another Blockly delete area is
deferred because it would require parallel drag ownership. One unobtrusive
working-state overlay replaces the old per-draft manager.

## Current limits

MVP 1 does not add executable generic predicates, recursive AND/OR,
arbitrary Canonical statement reorder, arbitrary Blockly programs, generic
Buy/Sell, new indicators, or Flow Capital Composer. Those limits do not freeze
the Blockly working program; unsupported structural gestures remain local
LogicDraft while Canonical remains the sole executable truth.
