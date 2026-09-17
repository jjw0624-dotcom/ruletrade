# Frontend Product Specification consolidation

> **Status: SUPERSEDED.** This intermediate specification lists capabilities
> subsequently delivered. Use [the living architecture](architecture.md).

## Gap audit

### Already implemented and preserved

- Stable Explore, Strategies, persisted Strategy, and BacktestRun routes.
- Immutable Revision-backed saves and separate mutable working Canonical state.
- Guided and Flow projections over one Canonical Strategy with validated semantic patches.
- Saved-versus-unsaved test execution and historical Run reopening.
- Real equity results and progressive Run details.
- Backend-owned Structured Decision Evidence list/detail contracts on `main`.

### Implemented but structurally inconsistent

- Strategy opened directly into editor depth rather than a shallow explanation.
- Guided and Flow shared data but offered little visible cross-navigation.
- Explore described backend/engine mechanics before the user's investment question.
- Result metrics, chart, and the future Analysis boundary were adjacent but not one research context.
- Test was available in the header, but its wording did not reflect saved versus current unsaved work.

### Promoted in this PR

- Canonical-derived Overview as the default Strategy representation, with a small set of real semantic edits.
- `Overview → Guided → Flow` progressive disclosure and component-ID-based Guided/Flow focus handoff.
- A stable Test action in the workspace header plus Overview actions; setup remains the existing lightweight modal.
- Evidence-derived chart markers, one shared selected decision session, Decision Timeline, asset outcomes, Why/Why-not paths, and source-rule navigation.
- Strong temporary, dismissible editor-only highlight after Result → Strategy navigation.
- Beginner-facing Explore and Flow labels that avoid compiler terminology.

### Backend-blocked

- Candidate Change, Compare, Only Differences, Why Different, and Keep/Discard.
- General `no signal` explanations, required Top-N cardinality, and uniform evaluated-universe membership where Evidence v1 does not state them.
- Exact source-field navigation: Evidence v1 identifies the Canonical component, not a config field path. Current Guided focus is therefore component-level.
- Rule → affected events: source refs are filterable, but the Strategy Workspace does not own a selected persisted Run context. Choosing “which run?” is product state, not a safe frontend guess.

### Explicitly later

- Revision diff/tree UI, Holdout, Forward, robustness, Replay, Feedback, AI interoperability, export, and community surfaces.

## State ownership

Overview, Guided, and Flow read the same editor Canonical. Only semantic patches affect dirty state. View selection, Flow position/viewport, source focus, chart timestamp, selected decision session, and selected asset remain UI state. Test config, transient result, persisted Run, and immutable Decision Evidence retain separate owners.

## Manual usability walkthrough

1. Open Explore and choose Growth + Defensive.
2. Read the Overview without opening an editor.
3. Change one Quick setting or choose Customize and edit a Guided question.
4. Confirm Flow shows the same value, then return through its selected-step action.
5. Test the strategy from the workspace header.
6. For a saved result with Evidence, select a chart decision marker.
7. Confirm the matching event and asset outcomes open together.
8. Select a rejected asset and identify its first recorded stopping point.
9. Choose View rule and confirm the Strategy opens with the responsible component visibly highlighted.

The key observation is whether any transition feels like opening a separate tool. Browser execution is required to validate that perception; component and state tests only validate the interaction contract.
