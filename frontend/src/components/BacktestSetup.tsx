import type { BacktestConfig } from "../domain/backtest";

export function BacktestSetup({ config, onChange, onClose, onRun }: { config: BacktestConfig; onChange: (config: BacktestConfig) => void; onClose: () => void; onRun: () => void }) {
  const valid = config.start_date <= config.end_date && Number(config.initial_cash) > 0;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="backtest-setup" role="dialog" aria-modal="true" aria-labelledby="backtest-setup-title">
    <header><div><span className="eyebrow">Backtest setup</span><h2 id="backtest-setup-title">Where and when should we test?</h2></div><button className="close-button" onClick={onClose} aria-label="Close backtest setup">×</button></header>
    <div className="setup-explainer"><b>Strategy</b><span>defines what happens</span><i>·</i><b>Backtest setup</b><span>defines the test period and starting amount</span></div>
    <div className="setup-fields"><label>Start date<input type="date" value={config.start_date} onChange={(event) => onChange({ ...config, start_date: event.target.value })} /></label><label>End date<input type="date" value={config.end_date} onChange={(event) => onChange({ ...config, end_date: event.target.value })} /></label><label className="cash-field">Initial investment<span className="money-input"><i>$</i><input type="number" min="1" step="1000" value={config.initial_cash} onChange={(event) => onChange({ ...config, initial_cash: event.target.value })} /></span></label></div>
    {!valid && <p className="form-error">Choose an end date after the start date and a positive initial investment.</p>}
    <footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid} onClick={onRun}>Run real backtest <span>→</span></button></footer>
  </section></div>;
}
