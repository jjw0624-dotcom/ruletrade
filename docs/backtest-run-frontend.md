# Persistent BacktestRun frontend vertical slice

The frontend consumes the resource contract from PR #24. A saved, clean Revision creates a durable
BacktestRun. An unsaved Canonical working copy continues to use the transient compatibility endpoint
and is explicitly labelled temporary. Backtest never silently saves a Revision.

## State and navigation

- `/strategies/{strategy_id}` loads the current immutable Revision and creates a mutable editor copy.
- Backtest form state remains local and never changes an existing Run.
- `POST /v1/revisions/{revision_id}/backtest-runs` is used only when the working copy equals its base.
- `/backtest-runs/{run_id}` loads the stored Run with `GET`; it never calls LEAN.
- Run history loads the Strategy's Revision summaries and lists the independent Runs belonging to
  each Revision. A Run from an earlier Revision is labelled accordingly.
- Temporary results remain in the editor session and never enter the persistent history list.

## Manual acceptance

1. Open a persisted Strategy and verify it says **Saved**.
2. Set the dates and initial investment, then choose **Run and save result**.
3. Verify the real Result opens as **Saved in Backtests**.
4. Return to the Strategy and verify the Run appears under **Backtests**.
5. Navigate to Explore, return to the Strategy, and select that Run.
6. In the browser network panel, verify reopening makes only `GET /v1/backtest-runs/{run_id}` and no
   Run creation or transient LEAN request.
7. Refresh on `/backtest-runs/{run_id}` and verify the same result restores.
8. Restart the backend, refresh, and verify it restores again from SQLite.
9. Change the dates and run again; verify two independent Runs appear.
10. Save a Canonical edit as a new Revision and verify the older Run remains labelled as an earlier
    Revision.
11. Make another Canonical edit without saving. Open setup and verify it says **Temporary backtest**.
12. Run it and verify the result says **Not saved to Backtests** and does not appear in history.

Docker/LEAN and a browser runtime were unavailable in the Work environment, so no real latency
sample or browser E2E is claimed. A real successful Run exposes persisted stage timings under
**Run details**.

## Intentional deferrals

No polling, interrupted-run recovery, Experiment grouping, Decision Evidence, Timeline, Why,
Candidate, Compare, cache, parameter sweep, authentication, or fake analytical data is introduced.
