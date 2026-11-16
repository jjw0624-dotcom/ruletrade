# V2 Builder completion baseline

**Status: CURRENT**

This document is the delivery ledger for completing the multi-perspective V2
Builder. It narrows the active milestone without narrowing the product vision.

## Product authority

- `CanonicalStrategyV2` is the only current authored and persisted financial
  authority.
- V1 is retained only as a legacy compatibility path while remaining saved work
  is migrated. New Builder capability, acceptance evidence, and execution
  closure target V2.
- Flow, Blocky, Rules, Guide, Summary, Code, Structure, Objects, and Inspector
  are perspectives over the same V2 meaning. Perspective state may preserve an
  unfinished draft or layout, but never becomes a second financial authority.
- Perspective equivalence is semantic equivalence. Views may omit or group
  details differently; they may not change assets, predicates, ranking, tie
  handling, shortage behavior, fallback/otherwise behavior, allocation,
  clocks, Unknown handling, statement order, or randomness semantics.
- A perspective that cannot edit or fully express a meaning must preserve it
  and report the limitation. It must not silently approximate or delete it.

## Current milestone

Complete a small, explicit set of strategies end to end before expanding the
language again. Each case must be created through production UI gestures,
committed to V2, saved and reopened, edited from another perspective, projected
back without semantic drift, executed through maintained LEAN lowering, and
linked from persisted Result/Evidence to the exact semantic address.

The milestone cases are:

| ID | Strategy meaning | Primary proof |
| --- | --- | --- |
| V2B-01 | One asset with an explicit rebalance clock | simplest complete perspective round trip |
| V2B-02 | Static Group → Filter → Top N → Buy | reusable object/reference separation and decision composition |
| V2B-03 | Explicit IF/OTHERWISE and selection-shortage fallback | preserves two distinct control meanings |
| V2B-04 | Growth/Defensive split with independent ownership | Flow capital structure and Blocky decision structure remain distinct |
| V2B-05 | Seeded probabilistic execution | deterministic replay and visible randomness semantics |

V2B-05 begins only after V2B-01 through V2B-04 pass. Draftable random blocks do
not count as execution support.

## Required evidence for every case

A case is complete only when one evidence record links all of the following:

1. production gestures from at least one authoring perspective;
2. the committed V2 semantic fingerprint and addressed components;
3. projection into every applicable perspective;
4. a semantic edit from a second perspective;
5. reverse projection to the first perspective;
6. Save, leave, reopen, and unchanged semantic fingerprint;
7. maintained lowering and generated C#;
8. a successful LEAN run with persisted Result and Decision Evidence;
9. Result → exact Builder address navigation;
10. explicit preservation or limitation messaging in a perspective that omits
    detail.

Equal labels, screenshots, isolated fixtures, compiler success alone, or one
matching backtest result do not establish semantic equivalence.

## Delivery phases

### Phase 0 — authority and evidence baseline

- Make V2 authority and the V1 compatibility boundary consistent in current
  documentation.
- Use this ledger as the sole Builder completion sequence.
- Reconcile existing tests and corpus evidence to V2B-01 through V2B-04.
- Remove stale current-status claims when implementation evidence does not
  support them.

### Phase 1 — V2B-01 single-asset round trip

- Close Guide, Flow, Blocky, Rules, Summary, and Code projection.
- Support one semantic edit from each editable perspective that claims it.
- Prove Save/reopen, LEAN execution, persisted Evidence, and Result navigation.

### Phase 2 — V2B-02 Group composition

- Keep Group definition, Group reference, Filter result, Choose result, and Buy
  sizing as distinct meanings.
- Close Add/Objects/Group Workspace continuation and cancellation.
- Prove units-per-member and total-cash Buy semantics without reinterpreting
  either as target allocation.

### Phase 3 — V2B-03 and V2B-04 control/capital closure

- Preserve OTHERWISE, shortage fallback, and omitted branch behavior as
  distinct semantics.
- Preserve parallel sleeves independently from sequential statements.
- Close typed removal, draft reconciliation, and stale revision recovery needed
  by these journeys.

### Phase 4 — manual WSL acceptance

After automated CI passes, run the exact PR head in WSL. Capture:

- repository SHA and environment diagnostic;
- screenshots at 1366×768, 1440×900, and 1920×1080 where geometry matters;
- create/edit/switch/save/reopen actions for the milestone case;
- Quick Test result and Decision Evidence;
- Result → Builder navigation;
- browser console and API errors;
- any semantic mismatch, unexpected reset, hidden control, overlap, or
  misleading capability message.

Manual acceptance may reject a green CI head. Fixes require a new head and a new
CI pass.

### Phase 5 — V2 Builder milestone closure

- Mark only the proven milestone cases as available.
- Keep other grammar as draftable, representable, lowerable, or verified
  according to its actual evidence.
- Freeze the completed round-trip contract while Detail BT, Hidden BT,
  robustness tests, Forward, Learning, and Competition are built on top.

## Merge gate

Every Builder pull request must identify its affected V2B cases, semantic
addresses, typed operations, state owners, capability claims, and evidence.

A pull request may merge only when:

- all required CI checks for its exact head commit have completed successfully;
- no required check is pending, skipped unexpectedly, cancelled, or stale;
- the head has not changed since those checks completed;
- required review and branch rules are satisfied; and
- any scheduled manual WSL acceptance for that phase has passed.

Do not enable an automatic merge that can bypass review of a later head. Record
the verified head SHA and CI run in the pull request before merging.

## Later product layers

Quick BT remains the immediate Builder execution action. Detail BT, Hidden BT,
robustness and random-baseline Tests, Forward, Learning, and Competition share
the same immutable V2 Strategy/Revision identity and LEAN execution foundation.
They do not define another strategy model.

Problem and Competition entry points use the same Builder with externally
supplied constraints such as allowed instruments, required instrument types,
required probabilistic behavior, trade limits, evaluation data, and objective.
Those constraints are separately identified evaluation policy and must be
enforced both in authoring capabilities and execution preflight.
