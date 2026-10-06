# MVP 1 capability ledger

Status: **CURRENT**  
Scope: production authoring and connected research surfaces after Flow Capital Composer and Asset Workspace v0.

## Contract

A capability is user-visible as **Available now** only when one production path is complete:

```text
user action
→ semantic or structural intent
→ backend validation
→ valid Canonical replacement
→ Flow / Blocky / Rules reprojection
→ Save / Test
```

A backend primitive, helper, projection, or isolated unit test is not by itself a product capability. Canonical is the only Strategy truth. FlowDraft and LogicDraft may hold incomplete local topology; failed mutations preserve the last committed Canonical. Current Asset Workspace may author only through advertised backend targets. Historical Asset Workspace is immutable and is addressed by exact Run, Revision, Decision event, and decision date.

The capability response from `/v1/canonical/strategies/authoring/capabilities` is the mutation authority. Frontend projection may attach product labels and context, but cannot promote an operation that the response does not advertise.

## Production capability matrix

Legend:

- **CREATE** — creates a complete valid semantic object.
- **EDIT** — backend-authoritative edit of an existing object.
- **REMOVE** — supported semantic inverse.
- **COMPOSE** — structural connection or valid-shape transformation.
- **DRAFT** — may begin locally but cannot Save/Test until committed or discarded.
- **FOCUS** — inspect/navigation only.
- **UNSUPPORTED** — no mutating affordance.
- **GUIDE** — a recipe explanation or high-level starting path, not independent truth.

| Semantic family | Blocky | Flow | Inspector | Asset Workspace | Guide | Authority / qualification |
| --- | --- | --- | --- | --- | --- | --- |
| Explicit asset set | FOCUS | decision detail / FOCUS | EDIT members | EDIT add/remove when `asset_set_targets` advertises it | GUIDE | `update_asset_set`; provider universes are excluded |
| Static Group membership | FOCUS | ownership context / FOCUS | EDIT through its asset set | EDIT add/remove when the referenced static asset set is advertised | GUIDE | Group identity stays distinct from Universe and Sleeve |
| Universe | FOCUS | selection detail | EDIT reference; explicit members through FROM | EDIT explicit/static membership only | GUIDE | `universe_targets` and `asset_set_targets`; provider-backed execution remains unavailable |
| Selection | decision statement / structural compose | target-determination unit | EDIT | FOCUS / handoff only | GUIDE | shared typed Selection semantics |
| Eligibility | statement detail | selection detail | EDIT shared Condition | Value handoff only when exact Eligibility selected | GUIDE | Predicate and Eligibility remain different roles |
| Predicate | IF/OTHERWISE CREATE/EDIT/REMOVE with LogicDraft | primary routing / COMPOSE with FlowDraft | EDIT shared Condition | Value handoff only when exact Predicate selected | GUIDE | incomplete conditions never enter Canonical |
| Selection fallback | distinct modifier | distinct incomplete-selection route | CREATE/EDIT/REMOVE when advertised | FOCUS | GUIDE | never Control OTHERWISE or shortage policy |
| Cooldown constraint | distinct statement modifier | attached constraint | CREATE/EDIT/REMOVE when advertised | FOCUS | GUIDE | never a capital destination |
| Allocation | statement/effect | primary capital relationship | EDIT | FOCUS | GUIDE | sleeve totals validated by backend |
| Split | existing program projection | CREATE/COMPOSE | EDIT resulting sleeves | FOCUS | GUIDE | `growth_defensive_targets`; one-click default is atomic 50/50 with IEF second sleeve |
| Sleeve | ownership context | primary ownership destination | rename/allocation EDIT | FOCUS | GUIDE | not Group or Universe |
| Schedule | timing statement | non-capital attachment | EDIT when advertised | FOCUS | GUIDE | independent schedules remain independent |
| Rebalance / Action | executable statement | target-realization action | FOCUS | FOCUS | GUIDE | execution semantics/compiler-owned |

No surface may turn **FOCUS**, **DRAFT**, **GUIDE**, or **UNSUPPORTED** into a live-looking mutation button. A disabled control must explain the missing context. A mutating control must own a dispatch implementation and visible rejection state.

## Connected production paths

### Flow Split

`Split` becomes Available only for a target returned in `growth_defensive_targets`. The production Add button and Flow drop editor share `dispatchSplitConstruction`. The default action sends one `transform_to_growth_defensive` operation with 50% Growth and 50% Defensive/IEF. The backend validates the original direct target shape, creates both sleeves, the second asset set/allocation, and the Portfolio, and rewires Rebalance atomically. On success the returned Canonical replaces editor state and capital-first Flow projects parallel ownership. On rejection no Canonical replacement occurs and the shared authoring error remains visible.

The optional Customize path changes explicit input before dispatch; it does not create local Strategy truth.

### Asset Workspace membership

Asset Workspace does not guess “the Strategy universe.” It derives labeled static Group, explicit Universe, or direct asset-set rows from the current Canonical, but renders mutation actions only for asset-set IDs advertised by `asset_set_targets`. Add and Remove both send the complete replacement membership through `update_asset_set`. The returned Canonical drives Asset Workspace status and Flow, Blocky, and Rules reprojection.

Provider-backed and otherwise non-advertised universes are inspect-only. Group, Universe, and Sleeve labels remain distinct even when a Group supplies a Universe asset set.

### Use in Strategy

A Value can be handed to Strategy authoring only when the current semantic selection is one committed comparison Condition. Asset Workspace does not fall back to an arbitrary first Condition. The exact selected component determines Predicate versus Eligibility, and `update_condition_expression` remains the backend-authoritative atomic boundary. Without an unambiguous target the button is disabled and explains the required selection.

### Current and historical research

Current mode reads current Canonical and may expose only capability-backed authoring. Historical mode is read-only. Its request includes Run, Decision event, exact Revision, and decision date. The backend rejects a Revision that differs from the Run and rejects an `as_of` after the Decision. It loads membership and rule identity from the Run's persisted Revision, not today's Canonical.

Persisted Evidence supplies exact `component_id` and `field_path` provenance for **View persisted rule**. Navigation may focus the same surviving semantic identity in today's Builder with a historical warning; it never guesses by label. Current edits cannot rewrite the saved Event, Evidence, Run, or Revision.

## Error, draft, and concurrency behavior

- Backend rejection leaves committed Canonical byte-for-byte unchanged.
- The authoring controller exposes a product error and marks the semantic edit invalid.
- Save/Test is gated while FlowDraft, LogicDraft, or a shared semantic edit is unfinished, applying, or invalid.
- Request sequencing ignores stale earlier authoring responses.
- Successful Canonical replacement re-queries capabilities, so a just-consumed one-shot target cannot remain falsely available.
- Flow/Blocky visual position, active view, Inspector state, and Research navigation remain presentation state.

## Test boundary

Automated coverage must include the production dispatch function used by the rendered control, backend request shape, Canonical replacement, and semantic reprojection—not only construction helpers. The maintained corpus covers one investment, Top-N, Eligibility, fallback, Cooldown, Predicate with and without ELSE, two sleeves, and independent schedules.

Headless tests prove dispatch, atomic state transition, capability gating, semantic identity, point-in-time bounds, draft gating, and reprojection. WSL/browser acceptance remains responsible for actual drag geometry, chart interaction, canvas readability, Inspector overlays, keyboard/delete behavior, and the complete saved Test/Evidence journey.
