# Builder architecture invariants

Invariant IDs are stable and mapped by [contract-test-map.json](contract-test-map.json).

1. **BARCH-001 — One persisted authority.** CanonicalStrategyV2 Revision is the only persisted financial meaning.
2. **BARCH-002 — Draft isolation.** No perspective mutates another perspective's Draft.
3. **BARCH-003 — Definition/reference separation.** Creating a Group inserts no Blocky or Flow reference.
4. **BARCH-004 — Flow independence.** Flow operations never route through Blockly.
5. **BARCH-005 — Guide independence.** Supported Guide authoring stays in Guide unless the user explicitly changes perspective.
6. **BARCH-006 — Navigation isolation.** Sidebar and perspective switches do not mutate Canvas meaning.
7. **BARCH-007 — Layout purity.** Layout-only changes do not change the semantic hash.
8. **BARCH-008 — Honest unsupported intent.** Unsupported meaning remains explicit Draft/unsupported state.
9. **BARCH-009 — Commit readiness.** Incomplete visual graphs cannot become working semantics.
10. **BARCH-010 — Execution preflight.** Test requires semantic, capability, provider, and runtime checks.
11. **BARCH-011 — Conflict preservation.** Conflicting Drafts are never silently overwritten.
12. **BARCH-012 — No duplicate semantic authority.**
13. **BARCH-013 — Projection is not execution authority.**
14. **BARCH-014 — V2-native execution.** Maintained V2 profiles do not detour through V1 Canonical.
15. **BARCH-015 — Evidence honesty.** Fixture injection is not UI-authorability proof.
16. **BARCH-016 — Explicit command outcome.** A product gesture either produces one atomic typed operation or returns a typed incomplete/unsupported outcome; an empty adapter result is never treated as success.
17. **BARCH-017 — Capability before callback.** Toolbox availability is derived from semantic context independently from UI callbacks and is never discovered by triggering a failing mutation.
18. **BARCH-018 — Selection is navigation.** Changing semantic or visual focus never commits, discards, disconnects, or replaces an unfinished Draft.
19. **BARCH-019 — Typed Flow removal.** Deleting a capital edge commits only when that exact projected relationship has one lossless atomic V2 removal; otherwise the request remains an explicit Flow-owned Draft.
20. **BARCH-020 — Recoverable object insertion.** Object definition, typed reference insertion, and active-graph designation are separate gestures; Add state and an unfinished typed-slot transaction survive perspective switching and Working Draft restore.
21. **BARCH-021 — Explicit revision conflict resolution.** A stale Save preserves the base Revision, latest Revision, local semantic work, and all perspective Drafts; automatic reapply is offered only when a deterministic three-way merge finds no overlapping semantic address.
22. **BARCH-022 — UI-authored execution equivalence.** An executable claim requires the same production-perspective gestures to produce the typed operation, backend-authored Canonical, persisted Revision, reopened projections, and maintained execution request proven by independent semantic and browser evidence.
