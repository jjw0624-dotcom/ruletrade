# Perspective capability matrix

Audited commit: `5ceaeda56bbe5012bf755d28c580dc848814492c`. Structured matrix: [perspective-capability-matrix.json](perspective-capability-matrix.json).

Statuses distinguish projection from authoring: **verified**, **partial**, **draft-only**, **read-only**, **unsupported**, and **N/A**.

| Perspective | Responsibility | Visible/understandable | Create/edit/delete | Draft/persist | Round trip / execution claim |
|---|---|---|---|---|---|
| Flow | capital routes, destinations, splits, exposure, fallback realization | verified projection | direct Investment/Split intent creation | layout + `flow_first` intent in Working Draft | atomic intent subset verified; no expression nodes |
| Blocky | events, conditions, calculations, AssetSet dependencies, actions | verified native projection/grammar | explicit active-graph commit for daily/monthly 100% single-asset rebalance | Working Draft v3/native JSON verified | proven subset compiles; all other complete graphs remain explicit unsupported drafts |
| Rules | declarative financial specification | verified | direct inline Investment/Split intent creation | `rules_first` intent in Working Draft | atomic intent subset verified; broader edits partial |
| Structure | ownership/hierarchy | verified | navigation, not general editing | derived | read-only |
| Objects | reusable definitions/references | verified | Group create verified; lifecycle partial | definition transaction + draft objects | definition/reference separation verified |
| Summary | meaning and readiness | verified | none | derived | read-only |
| Guide | explanation and navigation | verified | delegates supported edits | derived + Inspector draft | partial |
| Code | exact Canonical/revision envelope | verified | unsupported by design | derived | lossless read-only |
| Inspector | selected-object detail | verified | supported parameter subset | component-local until CAS | partial typed round trip |
| AI | external handoff/proposal | raw handoff | no semantic authority | proposal only | read-only/unverified |

### Feature boundaries

- Group is visible in Objects/Structure/Rules; a Group reference appears in Blocky only after explicit insertion. It has no Flow node until capital meaning references it.
- Selection is logical in Blocky/Rules and appears in Flow only where it affects capital routing.
- Event/State/Memory is omitted from Flow unless it changes a capital route.
- Summary/Guide/Code render semantically valid incomplete strategies without lowering.
- Fixed-money/quantity Buy, signals, loops and functions are draft-only or unsupported. Visual availability never proves execution support.

The matrix intentionally does not claim that every perspective can construct every strategy. Current evidence proves independent Flow and Rules atomic-intent authoring plus one deliberately narrow Blocky compiler subset. Broader bidirectional authoring remains explicit partial scope.
