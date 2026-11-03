# CI coverage ownership

Each expensive proof has one authoritative PR owner. Full Regression Nightly intentionally repeats the integrated guarantees to detect cross-component and scheduled regressions.

| Tier | Job | Authoritative responsibility |
|---|---|---|
| PR fast | Static & Contract | lock integrity, capability/schema evidence, generated bootstrap drift, Ruff/compile/shell syntax, TypeScript, production build |
| PR fast | Unit & Semantic | complete Python tests, complete frontend Vitest, SemanticProgramV2 validation, CAS, persistence, perspective contracts, Working Draft migration |
| Affected PR | LEAN Compilation | generated C# validity against the maintained LEAN assemblies |
| Affected PR | Docker core-selection | DailyValue, Group/Choose/Investment, Selection/fallback, semantic corpus, static Program |
| Affected PR | Docker score-composable | weighted Score, Allocation/capital conservation, composable execution and restart |
| Affected PR | Docker temporal-replay | Event/State/Memory, checkpoint/replay, temporal reliability, completed weekly to daily context |
| Affected PR | Production API Contract | actual saved V2 Revision through Docker LEAN to persisted Run, Result and Decision Evidence |
| Affected PR | Real Browser E2E | real Chrome Builder interaction, perspective round-trip, persisted result/evidence navigation |
| Main | all affected jobs forced on | integrated-system verification after merge |
| Nightly | parallel full regression | all maintained proofs plus repository validation and stable nightly aggregation |

## Deliberate consolidation

- Perspective-specific Python and Vitest files remain in their normal suites; the separate duplicate job is removed.
- API unit files remain in the full Python suite. Production API Contract now owns only its unique Docker-backed persisted V2 proof.
- Browser E2E does not substitute for DOM/unit tests; it owns graphical interaction only.
- Docker differentials do not substitute for reference/unit tests; they own cross-runtime equivalence.

## Required-check semantics

`Capability CI Required` remains stable. It verifies fast jobs unconditionally and checks each conditional job against the impact classifier:

- expected and successful → accepted;
- intentionally unaffected and skipped → accepted;
- expected but skipped/cancelled/missing/failed → rejected;
- unaffected but unexpectedly executed with a non-skipped result → rejected.

This prevents path filtering from silently erasing required evidence.
