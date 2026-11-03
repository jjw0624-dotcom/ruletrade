# Round-trip verification

Audited commit: `5ceaeda56bbe5012bf755d28c580dc848814492c`. Corpus: [perspective-roundtrip-corpus.json](../../corpus/perspective-roundtrip-corpus.json).

The corpus records capability, not aspirational gestures. “Supported” requires an actual operation or active-graph compiler, Canonical commit, reprojection and persistence evidence. Direct fixture injection proves projection/execution only.

| ID | Strategy | Verified path | Result |
|---|---|---|---|
| RT-A | QQQ 100% monthly | complete intent → Canonical → all projections → persisted Run | verified |
| RT-B | Group → qualification → Top N → Investment | object/Inspector operations and projections | partial UI round trip; engine subset verified |
| RT-C | Growth/Defensive 70/30 | atomic intent → Flow/Rules/Blocky → Docker | projection/execution verified; editing partial |
| RT-D | condition/OTHERWISE | intent → Rules/Blocky/Flow → Docker | projection/execution verified; editing partial |
| RT-E | weighted Score | intent → projections → reference/LEAN differential | execution verified; UI editing partial |
| RT-F | event/retest/confirmation | intent → Blocky/Rules → replay differential | execution verified; UI editing partial |
| RT-G | weekly context/daily action | intent → projections → replay differential | execution verified; UI editing partial |
| RT-H | nested AssetSet composition | Blocky draft + Canonical corpus | partial maintained subset |
| RT-I | fixed-money/signals/loops/functions | Working Draft only | deliberately nonexecutable |
| RT-J | Group/Subgroup lifecycle | Objects → explicit reference → Structure | create/reference verified; full lifecycle partial |

Negative cases N1–N9 require typed mismatch rejection, Investment/Rebalance separation, definition/reference separation, cross-draft isolation, no silent simplification, no incomplete commit, stale CAS rejection, cancellation safety and layout invariance.

Automated artifact tests validate exact operation coverage, corpus completeness and unsupported execution claims. Existing semantic/persistence/perspective tests supply runtime evidence; future implementation must attach test IDs to each newly promoted `partial` capability.
