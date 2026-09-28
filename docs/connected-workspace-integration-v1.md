# Connected Workspace Integration v1

**Status: MVP 1 implementation awaiting real browser acceptance.**

The Strategy workspace groups representations by the interaction they need,
without introducing a universal representation model:

| Family | Representations | Workspace contract |
| --- | --- | --- |
| Composer | Flow, Blocky | Canvas mechanics plus one RuleTrade Structure/Add semantic toolbox |
| Structured | Guide, Rules | Readable structured editing plus contextual authoring |
| Document / handoff | Summary, Code, AI | Wide document workspace without construction or Inspector chrome |

All families still project the same working Canonical and use the same backend
authoring contract. Switching family or moving presentation state does not dirty
the Strategy.

## Persisted Test command

Test is one explicit command over an immutable Revision:

- a clean persisted Strategy runs its existing Revision;
- a dirty persisted Strategy saves exactly once, then runs the exact Revision
  returned by that save;
- a failed or stale save creates no Run;
- real-data readiness is checked against the Revision that will execute.

The Test configuration modal remains open through local input validation,
Revision save, and data readiness. Once those pre-start gates accept the exact
Revision, the modal closes immediately before the persisted Run request begins;
the workspace owns the running state. An execution failure is then reported at
workspace level with a path back to the same Test settings. A failed save or
readiness check never dismisses the modal and never creates a Run.

The temporary execution path remains only for examples that do not yet have a
persisted Strategy and Revision.

## Research geometry

Inspector and Research are overlay layers above the persistent Builder plane.
Selecting a semantic object does not resize the canvas; Inspector covers the
right edge and closing it reveals the unchanged viewport. Research similarly
attaches from the right, is resizable from 45–85%, and suppresses Inspector
without changing Flow or Blockly world geometry. On narrow viewports it expands
to the existing full attached surface. Run, Decision, Evidence, comparison, and
semantic selection state remain independent of switching, opening, and resizing.

Rules cards are directly selectable and keyboard-focusable; inline semantic
values retain their natural backend-authoritative edit controls. There is no
separate “Inspect rule” command.

This integration does not add Strategy semantics, a new state store, arbitrary
wiring, or a representation AST. Validation, Forward, and Challenge remain
future work.
