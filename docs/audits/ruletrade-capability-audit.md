# RuleTrade capability audit

Status: repository evidence at `main` `73c7c58a270e87d32a16a127a6bdb8f789dc96f8`  
Machine source: [`corpus/ruletrade-capability-evidence.json`](../../corpus/ruletrade-capability-evidence.json)

This audit deliberately separates semantic existence, product authoring, persistence, reference evaluation, lowering, Docker execution, production API reachability, and browser proof. `UNKNOWN` is never treated as support. A `PASS` applies only to the named dimension and evidence.

## Executive finding

RuleTrade now exposes a complete persisted execution path for the maintained V2 subset while retaining a separate transient Quick Test route:

- `POST /v2/backtests/lean` accepts a V2 working copy, compiles the strict V2 plan directly, and returns a transient result.
- `POST /v2/revisions/{revision_id}/backtest-runs` loads the exact saved V2 revision and persists Run state, original V2 provenance, result, and Decision Evidence.

The V1 compatibility route and V2 route share codegen, runner, normalization and persistence. Unsupported V2 meaning remains rejected by strict lowering and is recorded as a typed failed Run.

## Architecture map

| Component | Actual authority | Implemented capability | Principal boundary |
|---|---|---|---|
| `CanonicalStrategyV1` | Historical compatibility source | Validation, persistence, compilation, persisted Runs | Not the authority for newly created strategies |
| `CanonicalStrategyV2` / `SemanticProgramV2` | New committed strategy meaning | Typed definitions, Program statements, validation, authoring, projections | Only maintained profiles lower |
| Typed authoring | Canonical mutation boundary | Validated operations plus expected source hash | UI may only accept backend-returned Canonical |
| Working Draft v3 | Visual work-in-progress | Disconnected/incomplete Blockly state, geometry, viewport, recovery | Never execution authority |
| Reference evaluator | Deterministic semantic oracle | Daily values, selection, score/allocation, event/state/memory, clocks | Not a production backtest API |
| V2 bridge | Strict execution boundary | V2 profile to typed LEAN plan | Rejects unproven profiles; must not simplify meaning |
| LEAN generator | Execution artifact builder | Deterministic C# and compile fixtures | Artifact is derived, not strategy source |
| `BacktestRunService` | Persisted Run lifecycle | V1/V2 pending/running/final status, provenance, result, evidence | V2 is limited to strict maintained profiles |
| Market data | Execution dependency | Preflight, provider/source kind, coverage and normalization | Most proof is synthetic/recorded, not live-provider proof |
| Builder perspectives | Projections of committed meaning | Blocky, Flow, Rules, Summary, Guide, Code, AI handoff | Completeness varies by perspective |

## Production Builder path

The mounted V2 path is:

1. strategy route loads `StrategyDetail.current_revision`;
2. `V2StrategyEditor` owns the working Canonical and save/run requests;
3. `SemanticProgramBuilderAdapter` projects the same committed Canonical into all representations;
4. supported edits become typed authoring requests;
5. the backend validates source hash/CAS and returns authoritative Canonical;
6. save appends an immutable Revision;
7. Quick Test calls the transient V2 LEAN route and renders in the existing detail rail.

Flow and Blocky keep layout/draft state outside Canonical. Rules and Inspector select the same semantic addresses. Code is currently read-only Canonical JSON. AI is an external handoff, not an AI service.

## Perspective findings

| Perspective | Current truth | Status | Highest-value missing work |
|---|---|---|---|
| Summary | Title plus short generated description | Partial | Objective, universe, schedule, conditions, allocation, risks, capability, gaps, latest Run |
| Rules | Addressed rule lines with Inspector edits | Partial | Complete safe editor coverage for maintained fields and explicit read-only limitations |
| Flow | Capital routing with layout-only draft and bounded semantic edits | Substantive/partial editing | Conservation diagnostics and end-to-end browser editing proof |
| Code | Read-only Canonical JSON | Honest but incomplete | Revision/hash/capability/provenance/evidence metadata |
| Guide | Blank recipes and shallow statement list | Partial | Strategy-specific walkthrough, blockers, and navigation |
| AI | External copy/paste context and validated proposal apply | Handoff only | No model capability; keep unavailable during stabilization |
| Blocky | Native Blockly plus Working Draft v3 | Frozen | Correctness/persistence defects only in this phase |
| Quick Test | Dates, capital, transient V2 LEAN result rail | Partial | UI navigation to persisted V2 Run history/evidence and browser E2E |

## Representative execution families

All six families have deterministic fixture, reference/lowering, generated C#, and Docker evidence in the repository. Their synthetic Docker proof is not equivalent to production API or browser completion.

| Family | Reference | Lowering/C# | Docker | Persisted V2 API Run | Browser result |
|---|---:|---:|---:|---:|---:|
| QQQ monthly | PASS | PASS | PASS | PASS | PARTIAL |
| Strongest ETFs | PASS | PASS | PASS | PASS | PARTIAL |
| Growth 70 / Defensive 30 | PASS | PASS | PASS | PASS | PARTIAL |
| Weighted Score | PASS | PASS | PASS | PASS | PARTIAL |
| Temporal breakout/retest | PASS | PASS | PASS | PASS | PARTIAL |
| Completed weekly → daily | PASS | PASS | PASS | PASS | PARTIAL |

The exact evidence paths and data provenance are maintained in the machine matrix and validated by `make check-capability-evidence`.

## Data provenance

Four distinct claims must remain separate:

1. **Synthetic fixture** — generated deterministic prices used by Docker differentials.
2. **Recorded provider fixture** — retained provider-shaped data with a known as-of range.
3. **Local real-data dataset** — `us-equity-daily-local`, available only when configured data coverage passes preflight.
4. **Live provider response** — not established by current CI or browser evidence.

Adjusted/raw policy, requested symbols, coverage, provider ID and source kind are represented in `BacktestRunProvenance` for persisted V1 and V2 Runs. V2 requirements are derived from the exact strict plan. The transient V2 response intentionally has no persisted result identity.

## Prioritized defects

1. **P0 — end-to-end proof gap:** current browser smoke does not prove Summary → Rules edit → save → Flow/Code → persisted Test → result/evidence → reopen.
2. **P1 — result completeness:** normalized results expose equity/return/order count/fees but not complete positions/allocation views for every path.
3. **P1 — perspective completeness:** Summary, Rules, Code and Guide omit required committed facts or diagnostics.
4. **P1 — frontend Run integration:** Quick Test still uses the transient route instead of exposing persisted V2 Run history and evidence.
5. **P2 — live-data proof:** live provider coverage and failure behavior remain environment-dependent and not browser-verified.

## Scope decision

Blocky grammar and visual redesign are frozen. Engine closure and the existing perspectives are completed before new grammar, Community, Challenges, or AI functionality.

