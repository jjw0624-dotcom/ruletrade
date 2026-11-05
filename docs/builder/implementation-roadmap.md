# Builder contract implementation roadmap

This roadmap is ordered by semantic risk and uses the gaps in
`implementation-gap-matrix.json`. Each phase must preserve the constitution in
`README.md`; completing a phase means adding its mapped contract and browser
evidence rather than only changing a surface.

## Phase A — independent perspective entry (this change)

- Keep Guide recipes in Guide until the user explicitly changes perspective.
- Prove that starting an Investment intent creates no Blocky draft blocks.
- Exercise the same journey in actual Chrome.

## Phase A2 — command and capability boundary (this change)

- Plan one atomic typed V2 operation before dispatch.
- Return explicit product and technical diagnostics for missing context.
- Reject multi-operation output until CAS supports an atomic batch.
- Keep command planning independent from perspective navigation.

## Phase A3 — controller decomposition (this change)

- Move command feedback and dispatch lifecycle into a dedicated controller.
- Derive toolbox availability as pure semantic-context data.
- Attach perspective callbacks only after capability calculation.
- Preserve labels, ordering, availability, and production interactions.

## Phase A4 — selection and Draft lifecycle (this change)

- Give navigation focus a controller with no Draft mutation authority.
- Preserve the active Draft and pending slot transaction while selecting objects.
- Require explicit discard or successful semantic reconciliation to clear work.
- Prove selection preservation in mounted interaction and actual Chrome.

## Phase B — typed Flow removal (this change)

- Replace projection-only deletion with an explicit typed semantic removal
  operation.
- Keep incomplete removal attempts in Flow draft state.
- Prove CAS conflict handling and cross-perspective reprojection.
- Treat partial Split-leg removal and projection-only action edges as Flow-owned
  Drafts until an atomic product operation can preserve their exact intent.

## Phase C — Object Library and Add preservation (this change)

- Separate object definition, reference insertion, and semantic activation.
- Persist Add visibility and an unfinished typed-slot insertion as non-semantic
  Working Draft state, exclude both from semantic hashing, and clear the
  transaction only on commit or cancel.
- Preserve disconnected and incomplete object references across switching and
  save/reopen.
- Prove that creating a Group never inserts or activates a visual block.

## Phase D — conflict lifecycle (this change)

- Surface the base revision, current revision, and still-uncommitted draft.
- Offer explicit reload/reapply/discard choices without silent overwrite.
- Add concurrent-edit browser coverage.

## Phase E — UI-authored execution equivalence (this change)

- Expand complete strategies authored only through production perspectives.
- Compare committed meaning, reference evaluation, generated C#/LEAN, and
  persisted execution results.
- Keep draftable, representable, lowerable, runtime-available, and executable
  as separate capability dimensions.
- Prove the minimal monthly QQQ strategy through Guide gestures, typed commit,
  Save, leave/reopen, cross-perspective projection, Test, V2 lowering, and
  generated C# without injecting Canonical as authoring evidence.

## Review and merge order

The constitution/Guide-correction branch is stacked on PR #92, and this command
boundary is stacked on that constitution head. Merge dependencies in order:
#91, #92, the constitution PR, then this command-boundary PR. Later phases
should be small dependent PRs whose base is the latest unmerged phase; none
should rewrite or silently supersede this contract.
