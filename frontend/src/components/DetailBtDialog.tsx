import { useEffect, useState, type FormEvent } from "react";

import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "../domain/backtest";
import { researchExperimentApi, type CatalogBaseRequest, type DetailExperimentExecution } from "../researchExperimentApi";

const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
const percent = (value: string | number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value));

export function DetailBtDialog({ revisionId, experimentId, onClose, onOpenRun }: {
  revisionId: string;
  base: CatalogBaseRequest | null;
  experimentId?: string | null;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const [name, setName] = useState("Detailed backtest");
  const [config, setConfig] = useState<BacktestConfig>(DEFAULT_BACKTEST_CONFIG);
  const [state, setState] = useState<"setup" | "running" | "error" | "success">("setup");
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<DetailExperimentExecution | null>(null);

  useEffect(() => {
    if (!experimentId) return;
    let active = true;
    setState("running");
    void researchExperimentApi.getDetail(experimentId).then((result) => {
      if (active) { setExecution(result); setState("success"); }
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Saved Detailed BT could not be loaded."); setState("error"); }
    });
    return () => { active = false; };
  }, [experimentId]);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setState("running"); setError("");
    try {
      const result = await researchExperimentApi.createDetail(revisionId, { name: name.trim(), config });
      setExecution(result); setState("success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Detailed BT could not complete.");
      setState("error");
    }
  };
  const result = execution?.runs[0];

  return <div className="modal-backdrop detail-bt-backdrop" role="presentation"><section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-bt-title">
    <header><div><span className="eyebrow">Full backtest</span><h2 id="detail-bt-title">Detailed BT</h2><p>Run the unchanged saved Revision once through the official LEAN pipeline with explicit dates, capital, and market dataset.</p></div><button type="button" className="close-button" aria-label="Close Detailed BT" onClick={onClose}>×</button></header>
    {state !== "success" || !execution || !result ? <form className="create-dialog detail-bt-form" onSubmit={(event) => void run(event)}>
      <label>Run name<input aria-label="Detailed run name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="detail-bt-config">
        <label>Start date<input aria-label="Detailed start date" type="date" value={config.start_date} onChange={(event) => setConfig({ ...config, start_date: event.target.value })} /></label>
        <label>End date<input aria-label="Detailed end date" type="date" value={config.end_date} onChange={(event) => setConfig({ ...config, end_date: event.target.value })} /></label>
        <label>Initial cash<input aria-label="Detailed initial cash" value={config.initial_cash} onChange={(event) => setConfig({ ...config, initial_cash: event.target.value })} /></label>
      </div>
      <label>Dataset<select aria-label="Detailed dataset" value={config.dataset_id} onChange={(event) => setConfig({ ...config, dataset_id: event.target.value as BacktestConfig["dataset_id"] })}>
        <option value="us-equity-daily-local">US equity daily (local)</option>
        <option value="golden-synthetic">Golden synthetic</option>
        <option value="filter-synthetic">Filter synthetic</option>
        <option value="cooldown-synthetic">Cooldown synthetic</option>
      </select></label>
      <p className="value-capability-note">Parameter tuning belongs in Hidden BT. FX, slippage, and finer condition intervals will appear here only as the execution engine gains real support.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={state === "running" || !name.trim()}>{state === "running" ? "Running Detailed BT…" : "Run Detailed BT"}</button></div>
    </form> : <div className="detail-bt-results">
      <div className="detail-bt-result-header"><div><span className="eyebrow">Completed detailed run</span><h3>{execution.experiment.name}</h3></div>{!experimentId && <button className="secondary-button" type="button" onClick={() => { setExecution(null); setState("setup"); }}>Run again</button>}</div>
      <section className="empty-state"><h3>{result.result ? percent(result.result.total_return) : result.status}</h3><p>{result.result ? `${money(result.result.final_value)} · ${result.result.total_orders} orders · ${money(result.result.total_fees)} fees` : "No normalized result was produced."}</p></section>
      {onOpenRun && <div className="dialog-actions"><button type="button" className="primary-button" onClick={() => onOpenRun(result.id)}>Open full result</button></div>}
    </div>}
  </section></div>;
}
