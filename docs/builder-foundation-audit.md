# Builder foundation audit

## Verified baseline

This audit is based on the production `StrategyBuilderWorkspace` path stacked through PRs 65, 66, and 67. `SemanticProgramV2` remains committed authority; `ProgramWorkingDraft` v3 stores recoverable visual work.

## Ownership before this correction

| State or interaction | Creator | Effective owner before | Persistence | Verified conflict |
|---|---|---|---|---|
| V2 Canonical | API/bootstrap and V2 authoring API | backend CAS revision | Strategy revision | Correct authority; unchanged |
| Blockly workspace | `ProgramBlockyProjection` | Blockly plus React mirror | native JSON in Working Draft | Every native edit emitted `canvasBlocks`, positions and connections; a React effect then replayed the same graph |
| Block deletion | Blockly trash/context menu and Inspector | Blockly plus React | Working Draft | Inspector deleted the React mirror and waited for reconciliation to dispose the native block |
| Block drag | Blockly gesture | Blockly plus `onBlockMove` plus full snapshot | Working Draft | One draft move could produce two React updates |
| Block Add | native flyout plus HTML draggable tools | Blockly and React | Working Draft | Two drag protocols and coordinate systems existed |
| Group definition | Object Library intent | Inspector draft plus synthetic Blockly block | Canonical on commit | `draft.kind === group` caused a `Create Group` canvas block even without a reference request |
| Group reference | Assets flyout | Blockly or React slot insertion | Working Draft | Slot completion created the reference through the React mirror instead of Blockly |
| Selection | Blockly and shared shell | React string plus Blockly global selection | partially persisted | Draft selection restored inconsistently |
| Flow layout | React Flow | React Flow | Working Draft | Correctly separate from Canonical; unchanged |

## Root causes with code evidence

1. `ProductBlockyProjection.tsx` registered native Blockly listeners, serialized the workspace, and also reconciled React-owned `connections` back into the same live workspace. This made persistence data behave as a second live authority.
2. `SemanticProgramBuilderAdapter.tsx` exposed an HTML5 `onToolDrop` path in parallel with Blockly's flyout gesture system. Pointer capture and coordinate conversion therefore depended on two engines.
3. The projection synthesized a Blockly block for a Group definition draft. That conflated an Object Library definition with a visual reference.
4. Draft cancellation cleared the full `blockConnections` map and diagnostics, so cancelling one object draft could erase unrelated recoverable work.
5. The left React panel selected Blocky categories while a separate permanent Blockly flyout rendered previews. This split one Add interaction across unrelated DOM and Blockly surfaces.

## Correction

- Production Blocky uses one native category toolbox. Blockly owns category selection, preview geometry, drag/drop, connections, deletion, coordinates, serialization, and undo/redo.
- React consumes snapshots for persistence and validation, but no longer replays draft connections into the live workspace.
- Inspector deletion calls the native workspace API.
- Group drafts never create a canvas block. The dedicated Group Workspace edits the definition; only an explicit typed-slot request inserts a native Group reference.
- Cancelling a semantic draft removes only that transaction and preserves unrelated native fragments, connections, diagnostics, and geometry.
- Flow continues to own only capital-node layout and viewport.

## Risks and remaining evidence

The repository did not contain a direct Playwright dependency or browser test script at this dependency head, and this execution environment has no Chromium/Chrome executable. Native gesture and layout behavior therefore requires the browser acceptance suite described in `builder-browser-acceptance.md`; jsdom is not treated as proof.
