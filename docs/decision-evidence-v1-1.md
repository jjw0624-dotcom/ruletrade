# Decision Evidence v1.1 product-critical gap fill

> **Status: CURRENT subsystem contract.** “v1.1” is the product-slice name; the
> wire and persisted schema is Evidence v2.

This slice is an additive evolution of Structured Decision Evidence. Evidence remains objective
execution truth owned by one immutable BacktestRun; explanation wording remains a frontend concern.
No strategy, target, order, or fill semantic changes.

## Compatibility and version

The persisted and machine-contract schema version is **2** (`RULETRADE_EVIDENCE_V2`). The product
name “v1.1” describes the small scope, but the wire/persisted version changes because absence in a v1
payload meant “unknown,” while v2 can explicitly record a negative signal or stopping stage.

The collector reads v1 and v2. A Run contains one version only. Existing v1 rows are not rewritten:
their new optional fields deserialize as `null`. The API exposes each event's `schema_version`, so a
client can distinguish old unknown facts from an explicit v2 state.

## Facts added

| Question | v2 execution fact |
|---|---|
| How many were needed? | `selection.required_count`; random selection also records its configured count |
| Was the asset evaluated by the filter? | Presence in `filter.evaluations` |
| Was it in that filter's intended path? | `filter.decision_universe` |
| Did a Top-N signal exist? | `selection.asset_outcomes[].signal = present | absent` |
| Where did it stop? | `filter`, `rank_cutoff`, `primary_selection_incomplete`, `fallback_replacement`, or `cooldown` |
| Which parameter owned the condition? | Optional Canonical-relative `source_components[].field_path` |

`selection.asset_outcomes` contains exactly the assets evaluated by ranking/Top N. Each outcome
records its one-based rank, explicit Top-N signal state, primary-selection membership, and optional
first stopping stage. An asset absent from these outcomes has no selection-evaluation fact; absence is
never interpreted as `signal=absent`.

Filter evidence distinguishes three cases: in the decision universe and evaluated, in the decision
universe but not evaluated (for example, data was unavailable), and not represented in that decision
universe. It does not guess why data was unavailable.

Cooldown retains the upstream Top-N event and source. A candidate therefore has an explicit Top-N
`signal=present`, followed by a separate Cooldown event whose stop is `cooldown` when ineligible.
The Top-N source remains `config.count`; Cooldown remains `config.duration`.

## Source field paths

Field paths are optional strings relative to a component in the stored Canonical Revision:

- trailing-return score: `config.lookback_bars`
- ranking: `config.direction`
- Top N or Random N: `config.count`
- positive-return filter: `config.threshold`
- Cooldown: `config.duration`

No path is emitted for a fact without one truthful, uniquely responsible editable field. Paths are
Canonical identities, not DOM selectors, Guided control names, IR paths, or generated-C# names.
Current parameter values remain in the immutable Revision or evidence fact; evidence does not
duplicate the full component.

## Strategy-path contract

- Filter/Momentum/Top N: explicit filter universe and evaluations, required count, rank, signal,
  primary selection, and structural stop.
- Fallback: an incomplete primary candidate stops at `fallback_replacement`; fallback activation
  and final selection remain separate facts.
- Cooldown: the Top-N candidate signal precedes a separate eligible/blocked fact. Only a blocked
  candidate has `stopping_stage=cooldown`.
- Random selection: required count is known, but there is no standalone signal concept, so none is
  manufactured.
- Fixed asset sleeves: contribution evidence is unchanged; there is no selection signal to invent.

## Order/fill boundary

Target decisions still do not claim to be orders or fills. The current runtime has no stable
one-to-one identity across aggregate targets, order tickets, partial fills, liquidation, and subsequent
broker events. Decision-to-order linkage is therefore deferred to a separate execution artifact.

## Frontend and Candidate boundary

The chart-first Research Inspector may now render “1 of 2 assets qualified” only for v2 evidence and
distinguish explicit signal absence, rank cutoff, fallback replacement, and Cooldown blocking. Result
→ Rule navigation carries `component_id + optional field_path` into the existing editor-only focus
state. Guided uses the exact field when it has that control and retains component-level navigation
when the path is absent. The editor-only research context carries the Run, selected session, and
selected asset across Result → Rule → Back to decision, while source focus remains independently
dismissible; neither path mutates Canonical. Older v1 evidence keeps the existing cautious wording.
Candidate creation, patches, editing, comparisons, and prose explanation remain out of scope.

## Size sanity

The deterministic cross-semantic fixture remains 10 events:

- v1: 1,911 bytes, 191.1 bytes/event
- v2: 2,291 bytes, 229.1 bytes/event
- delta: +380 bytes (+19.9%)

The Golden fixture remains 2 events:

- v1: 409 bytes, 204.5 bytes/event
- v2: 456 bytes, 228.0 bytes/event
- delta: +47 bytes (+11.5%)

The additions are compact scalar/list facts. Canonical source, IR, LeanPlan, generated source, and logs
are not duplicated per event.
