import type { BacktestConfig } from "../domain/backtest";
import {
  marketDataReasonMessage,
  type DataReadiness,
} from "../domain/marketDataReadiness";

interface BacktestSetupProps {
  config: BacktestConfig;
  onChange: (config: BacktestConfig) => void;
  onClose: () => void;
  onRun: () => void;
  onCheckData?: () => void;
  persistence?: "historical" | "temporary";
  readiness?: DataReadiness;
}

function formatPeriod(start: string, end: string): string {
  const format = (value: string) => new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
  return `${format(start)} – ${format(end)}`;
}

function DataReadinessPanel({
  readiness,
  onCheck,
}: {
  readiness: DataReadiness;
  onCheck?: () => void;
}) {
  if (readiness.status === "not_checked") {
    return <section className="data-readiness"><header><strong>Historical data</strong><span>Not checked</span></header><p>Historical data will be checked before this saved test starts.</p>{onCheck && <button className="text-button" onClick={onCheck}>Check now</button>}</section>;
  }
  if (readiness.status === "checking") {
    return <section className="data-readiness checking" role="status"><header><strong>Historical data</strong><span>Checking…</span></header><p>Checking the assets and earlier history this strategy requires.</p></section>;
  }
  if (readiness.status === "error") {
    return <section className="data-readiness error" role="alert"><header><strong>Historical data</strong><span>Check failed</span></header><p>We couldn't check historical data right now.</p>{onCheck && <button className="text-button" onClick={onCheck}>Try again</button>}</section>;
  }

  const maximumWarmup = Math.max(
    0,
    ...readiness.result.symbols.map((item) => item.warmup_observations_required),
  );
  return <section className={`data-readiness ${readiness.status}`}>
    <header><strong>Historical data</strong><span>{readiness.status === "available" ? "Ready" : readiness.status === "partial" ? "Partly ready" : "Unavailable"}</span></header>
    {readiness.status !== "available" && <p><strong>Strategy is ready, but historical data is unavailable for this test.</strong></p>}
    <ul>{readiness.result.symbols.map((item) => <li key={item.symbol} className={item.status}>
      <div><strong>{item.symbol}</strong><span>{item.status === "available" ? "✓ Ready" : marketDataReasonMessage(item.reason)}</span></div>
      {item.reason === "insufficient_history" && <small>{item.warmup_observations_required} earlier trading observations required · {item.warmup_observations_available} available</small>}
    </li>)}</ul>
    <div className="readiness-period"><span>{formatPeriod(readiness.result.requirement.requested_start, readiness.result.requirement.requested_end)}</span>{readiness.status === "available" && <span>✓ Enough earlier history{maximumWarmup > 0 ? ` · ${maximumWarmup} observations required` : ""}</span>}</div>
    {readiness.status !== "available" && <details><summary>Developer details</summary><ul>{readiness.result.symbols.filter((item) => item.status !== "available").map((item) => <li key={item.symbol}><code>{item.symbol}: {item.reason}</code></li>)}</ul></details>}
  </section>;
}

export function BacktestSetup({
  config,
  onChange,
  onClose,
  onRun,
  onCheckData,
  persistence = "temporary",
  readiness = { status: "not_checked" },
}: BacktestSetupProps) {
  const valid = config.start_date <= config.end_date && Number(config.initial_cash) > 0;
  const realData = config.dataset_id === "us-equity-daily-local";
  const readinessBlocksRun = realData
    && persistence === "historical"
    && (readiness.status === "checking"
      || readiness.status === "partial"
      || readiness.status === "unavailable");

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="backtest-setup" role="dialog" aria-modal="true" aria-labelledby="backtest-setup-title">
    <header><div><span className="eyebrow">Test strategy</span><h2 id="backtest-setup-title">Where and when should we test?</h2></div><button className="close-button" onClick={onClose} aria-label="Close test setup">×</button></header>
    <div className="setup-explainer"><b>Your strategy</b><span>decides what happens</span><i>·</i><b>This test</b><span>chooses the period and starting amount</span></div>
    <div className={`run-policy ${persistence}`}><strong>{persistence === "historical" ? "Saved test" : "Testing current changes"}</strong><span>{persistence === "historical" ? "This result will be saved so you can reopen it later." : "This result is temporary. Save the strategy first if you want future tests kept in Backtests."}</span></div>
    <div className="setup-fields">
      <label>Start date<input type="date" value={config.start_date} onChange={(event) => onChange({ ...config, start_date: event.target.value })} /></label>
      <label>End date<input type="date" value={config.end_date} onChange={(event) => onChange({ ...config, end_date: event.target.value })} /></label>
      <label className="cash-field">Initial investment<span className="money-input"><i>$</i><input type="number" min="1" step="1000" value={config.initial_cash} onChange={(event) => onChange({ ...config, initial_cash: event.target.value })} /></span></label>
      <label>Market data<select value={config.dataset_id} onChange={(event) => onChange({ ...config, dataset_id: event.target.value as BacktestConfig["dataset_id"] })}><option value={config.dataset_id === "us-equity-daily-local" ? "cooldown-synthetic" : config.dataset_id}>Example data</option><option value="us-equity-daily-local">US historical data</option></select></label>
    </div>
    {realData && persistence === "historical" && <DataReadinessPanel readiness={readiness} onCheck={valid ? onCheckData : undefined} />}
    {realData && persistence === "temporary" && <section className="data-readiness boundary"><header><strong>Historical data</strong><span>Checked during test</span></header><p>Data readiness will be checked when this temporary test starts. It won't use the saved Revision to represent your unsaved changes.</p></section>}
    {!valid && <p className="form-error">Choose an end date after the start date and a positive initial investment.</p>}
    <footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid || readinessBlocksRun} onClick={onRun}>{readiness.status === "checking" ? "Checking data…" : persistence === "historical" ? "Run and save result" : "Test current changes"} <span>→</span></button></footer>
  </section></div>;
}
