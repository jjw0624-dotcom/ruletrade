# Market-data preflight UX

The Test setup checks historical-data readiness only for a clean, saved Revision using
`us-equity-daily-local`. It calls the merged Market Data v0 contract:

```text
POST /v1/revisions/{revision_id}/market-data/preflight
body: { "config": BacktestConfig }
```

Readiness is UI-only state keyed by the exact Revision and BacktestConfig. Changing the
Revision, start date, end date, initial investment, or dataset makes an earlier result
stale. The UI does not write availability into Canonical strategy state or editor
dirty/save state.

An `available` response enables the existing persisted BacktestRun request. `partial`
and `unavailable` responses show the blocking assets and stop before that request.
A request/network error is shown separately from confirmed unavailability. Backend reason
codes remain available under Developer details, while normal copy avoids LEAN paths,
archives, Security Master terminology, and operator configuration.

Unsaved Canonical edits continue through the existing transient backtest endpoint. Because
Market Data v0 preflight is Revision-based, the UI does not preflight the saved Revision
and claim it represents those edits, and it never auto-saves. Test setup explains that
readiness will be checked when the temporary test starts. Synthetic fixture tests retain
their existing path and do not show real-data readiness.

Ticker editing remains syntactic authoring. The frontend does not preflight keystrokes,
search symbols, calculate trading calendars, or infer availability. Saved Test setup is
the authoritative product checkpoint, and exact warm-up observations come only from the
backend response.

## Manual acceptance

The local examples below describe the cache previously exercised for Market Data v0; they
are not hard-coded product assumptions and make no claim about data origin or licensing.

Positive path:

1. Open a saved, clean QQQ Strategy.
2. Choose **US historical data** and a period covered by the local cache.
3. Confirm QQQ is shown as **Ready** and earlier history is sufficient.
4. Select **Run and save result**.
5. Confirm the existing persisted real-data Run opens.

Negative path:

1. Open a saved, clean Strategy requiring SCHG, SOXX, or VGT in the currently incomplete
   developer cache.
2. Choose **US historical data**.
3. Confirm the blocking assets and product-level reasons are visible.
4. Confirm **Run and save result** is disabled and no persisted Run request is made.

Operational acquisition and cache remediation remain in
[Market Data v0](market-data-v0.md), not the normal product UI.
