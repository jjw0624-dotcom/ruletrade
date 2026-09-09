# Decision Timeline and Research Inspector frontend

This slice presents immutable Structured Decision Evidence v1 from a persisted BacktestRun. Evidence
is execution truth; all prose and visual grouping are deterministic presentation. The frontend never
parses runtime logs and never asks an AI to explain a decision.

## Presentation policy

- The summary endpoint is loaded first and kept in backend ordinal order.
- Same-session summaries are grouped into one timeline decision while their event identities remain
  intact. Selecting the session fetches only that session's event details.
- Explanations state only explicit evidence. In particular, v1 records an `insufficient` primary
  selection but not its required cardinality, so the UI does not invent “needed 2.”
- Filter rejection, rank position, primary selection, fallback, Cooldown eligibility, retained
  snapshot dates, sleeve scaling, and final targets retain separate meanings.
- `Show in strategy` follows stable source component IDs. It finds the active Strategy owning the
  Run Revision, opens its current workspace, switches to Flow, and focuses that component without
  changing Canonical semantics.
- Selecting a timeline session highlights the matching date on the existing equity curve when an
  equity point exists for that session.

## Manual non-quant usability flow

### Fallback / Sleeves

1. Open a successful persisted Fallback or Sleeves Run.
2. Under Analysis, select a timeline date labelled **Fallback decision**.
3. Ask the tester to explain what happened and why fallback activated.
4. Select a rejected asset and ask why it stopped.
5. Open a portfolio rebalance and ask how a local sleeve weight became its final weight.
6. Ask which saved sleeve snapshot dates the rebalance used.
7. Choose **Show in strategy** and verify the workspace opens in Flow with the source component
   selected. Confirm that the Canonical source did not change.

### Cooldown

1. Select an **Eligibility decision** containing a blocked candidate.
2. Ask why a signal existed without an eligible purchase.
3. Ask the tester to identify elapsed versus required completed trading sessions and the recorded
   last-exit date.

### Honest unavailable states

1. Open a schema-v2 legacy successful Run and confirm the UI says evidence is unavailable without
   rerunning it.
2. Run an unsaved working copy and confirm its temporary Result asks for a saved Backtest before
   decision inspection.

## Intentional limits

Reverse navigation from a Strategy rule to matching Run events is deferred. Although summary source
references make client-side filtering possible, the current Strategy workspace has no durable Run
selection context, and adding one here would expand routing/state beyond this slice. Chart-to-timeline
selection is also deferred; timeline-to-chart selection is implemented without introducing new chart
datasets.

Candidate editing, Compare, Only Differences, Feedback, Replay, AI explanation, generic inspectors,
and generic analytics are not included.
