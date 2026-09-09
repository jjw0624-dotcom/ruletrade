import type { BacktestConfig } from "../domain/backtest";

export function BacktestSetup({ config, onChange, onClose, onRun, persistence = "temporary" }: { config: BacktestConfig; onChange: (config: BacktestConfig) => void; onClose: () => void; onRun: () => void; persistence?: "historical" | "temporary" }) {
  const valid = config.start_date <= config.end_date && Number(config.initial_cash) > 0;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="backtest-setup" role="dialog" aria-modal="true" aria-labelledby="backtest-setup-title">
    <header><div><span className="eyebrow">Test strategy</span><h2 id="backtest-setup-title">Where and when should we test?</h2></div><button className="close-button" onClick={onClose} aria-label="Close test setup">×</button></header>
    <div className="setup-explainer"><b>Your strategy</b><span>decides what happens</span><i>·</i><b>This test</b><span>chooses the period and starting amount</span></div>
    <div className={`run-policy ${persistence}`}><strong>{persistence === "historical" ? "Saved test" : "Testing current changes"}</strong><span>{persistence === "historical" ? "This result will be saved so you can reopen it later." : "This result is temporary. Save the strategy first if you want future tests kept in Backtests."}</span></div>
    <div className="setup-fields"><label>Start date<input type="date" value={config.start_date} onChange={(event) => onChange({ ...config, start_date: event.target.value })} /></label><label>End date<input type="date" value={config.end_date} onChange={(event) => onChange({ ...config, end_date: event.target.value })} /></label><label className="cash-field">Initial investment<span className="money-input"><i>$</i><input type="number" min="1" step="1000" value={config.initial_cash} onChange={(event) => onChange({ ...config, initial_cash: event.target.value })} /></span></label></div>
    {!valid && <p className="form-error">Choose an end date after the start date and a positive initial investment.</p>}
    <footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid} onClick={onRun}>{persistence === "historical" ? "Run and save result" : "Test current changes"} <span>→</span></button></footer>
  </section></div>;
}
