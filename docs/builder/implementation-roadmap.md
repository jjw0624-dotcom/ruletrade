# Builder contract implementation roadmap

This roadmap is ordered by semantic risk and uses the gaps in
`implementation-gap-matrix.json`. Each phase must preserve the constitution in
`README.md`; completing a phase means adding its mapped contract and browser
evidence rather than only changing a surface.

## Phase A — independent perspective entry (this change)

- Keep Guide recipes in Guide until the user explicitly changes perspective.
- Prove that starting an Investment intent creates no Blocky draft blocks.
- Exercise the same journey in actual Chrome.

## Phase B — typed Flow removal

- Replace projection-only deletion with an explicit typed semantic removal
  operation.
- Keep incomplete removal attempts in Flow draft state.
- Prove CAS conflict handling and cross-perspective reprojection.

## Phase C — Object Library and Add preservation

- Separate object definition, reference insertion, and semantic activation.
- Preserve disconnected and incomplete object references across switching and
  save/reopen.
- Prove that creating a Group never inserts or activates a visual block.

## Phase D — conflict lifecycle

- Surface the base revision, current revision, and still-uncommitted draft.
- Offer explicit reload/reapply/discard choices without silent overwrite.
- Add concurrent-edit browser coverage.

## Phase E — UI-authored execution equivalence

- Expand complete strategies authored only through production perspectives.
- Compare committed meaning, reference evaluation, generated C#/LEAN, and
  persisted execution results.
- Keep draftable, representable, lowerable, runtime-available, and executable
  as separate capability dimensions.

## Review and merge order

The current branch is stacked on PR #92. Merge dependencies in order: #91,
#92, then this constitution/Guide-correction PR. Later phases should be small,
dependent PRs whose base is the latest unmerged phase; none should rewrite or
silently supersede this contract.
