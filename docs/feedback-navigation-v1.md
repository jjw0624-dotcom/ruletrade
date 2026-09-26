# Feedback Navigation and Result Events v1

**Status: MVP 1 CURRENT.** Read with the [living architecture](architecture.md), [editable representations](editable-representations-v1.md), [connected workspace contract](connected-workspace-contract-v1.md), and [completed connected research loop](connected-research-loop-v1.md).

## Research grammar

```text
saved Result
  → Result event (presentation/navigation)
  → exact persisted Decision ID
  → selected decision-time Evidence
  → component_id + optional field_path
  → SemanticSelection in the current representation
```

A Result event is a disposable UI projection of persisted Decision summaries. It carries `runId`, a representative exact `decisionId`, all Decision IDs in the same session, session date, factual category, and label. It is not new Evidence, Strategy truth, or an event-sourced domain model. Selection fetches details by exact persisted IDs. Timestamp, asset name, labels, and list position never identify a Decision.

The initial Result request performs one Decision-summary GET. It does not fetch every detail. Selecting one Result event fetches only the small set of persisted Decision records in that session. No chart-specific backend endpoint is needed.

## Progressive disclosure and density

Lightweight Charts 5.2.1 owns the Quick Result equity rendering, crosshair, resize, zoom, pan, and marker mechanics. It is Apache-2.0; the chart enables the TradingView attribution logo and displays the required public attribution link. RuleTrade owns Decision meaning, category, identity, Evidence and selection. The library's marker ID is only an adapter key containing RuleTrade's persisted `decisionId`.

The complete accessible event index is a compact, paged list of 20 controls. The chart displays at most 48 evenly sampled overview markers and always retains the selected event, avoiding the old Daily O(n) marker/button wall. Filters are factual and appear only for categories present in the persisted summaries:

- Selection — filter, selection, random selection or final selection behavior.
- Fallback — persisted fallback logic was evaluated; activation is stated only by loaded Decision detail.
- Eligibility — Cooldown eligibility behavior.
- Portfolio — allocation, target, snapshot or state behavior.

Summary records cannot reliably say “entered” or “not selected” without opening detail, so v1 does not manufacture those filter categories. Filtering, paging, chart range, crosshair and zoom are presentation state: none changes Canonical, saves a Revision, creates a Run, invokes LEAN, or creates a Candidate/Comparison.

## Selected Decision and navigation

The detail hierarchy is Date → What happened → At the decision → Why/why-not → View rule. Existing Decision Evidence components remain the explanation engine. The explicit `View rule` action sets the shared semantic address in the currently active representation; `View in Flow` remains an intentional representation switch. Flow, Blocky, Rules, Guide and Code locate the address through their own projections. Research keeps its Run, `decisionId`, session, selected asset, width and open state while representations switch.

Rule → Show where this mattered remains a GET-only Evidence query. Its `ResearchContext` now carries the exact first matching persisted Decision ID as well as Run/session/asset, so reopening selects the exact event without a new Test.

Evidence always belongs to its saved Run and Revision. When Result navigation enters a newer current Strategy, the workspace labels the historical Revision. A surviving component may be focused, but current field values may differ. If that component no longer exists, the current Strategy is not heuristically matched: selection remains empty and the persisted historical Evidence stays open in Research. A historical Revision editor is **DEFERRED**.

## Hindsight safety

Decision Evidence is information recorded when the Strategy acted. Subsequent outcome is a separate research concept. Current normalized Results contain portfolio equity but not a reliable per-asset price series aligned to every Decision, so v1 does **not** compute next-window asset returns or call a Decision a mistake, bad buy, missed opportunity, or recommendation. Drawdown-range navigation is also **DEFERRED**; point Decision navigation is the proven seam.

Quick Result answers “What did this Strategy do, and why?” It does not test robustness, optimize parameters, or rank hindsight opportunity. Those questions belong to future Validation. Existing Try Change remains user-initiated and limited to the supported immutable Candidate/Comparison workflow.

## Scope classification

| Classification | Work |
| --- | --- |
| REUSE EXISTING | persisted Run/Evidence APIs, Decision Inspector, Research workspace, SemanticSelection, Candidate/Comparison, Rule→Result |
| RESULT PRESENTATION | narrow Result-event projection, factual filters, paged list, selected-event hierarchy |
| FEEDBACK NAVIGATION | exact Decision ID in `ResearchContext`, current-representation View rule, historical warning |
| SMALL DOMAIN CONTRACT | `runId + decisionId` presentation identity; no backend schema change |
| PERFORMANCE FIX | one summary GET, selected-session detail GETs only, 48 chart markers, 20 list controls |
| HINDSIGHT SAFETY | explicit decision-time wording; subsequent outcome deferred |
| DEFER | per-asset subsequent returns, drawdown range navigation, clustering framework, recommendation/scoring, Comparison expansion, Validation |

## WSL acceptance handoff

```sh
git checkout feature/connected-research-loop-completion
npm --prefix frontend ci --no-audit --no-fund
uv sync --extra bt --extra dev --locked
make api        # terminal 1
make frontend   # terminal 2
```

Open a persisted Strategy and run the prompt's Monthly and Daily journeys. In particular: select a chart marker and list item; confirm the exact Decision detail; use View rule in Flow, Blocky and Rules; return to Result and verify the Decision remains selected; zoom/pan and resize Research; apply each factual filter; confirm a Daily Result shows at most 20 event buttons per page rather than every Decision; use Rule → Show where this mattered; verify historical/removed-component messages; and confirm no Run appears unless Test is explicitly submitted. Real LEAN acceptance requires the configured local dataset and Security Master files.
