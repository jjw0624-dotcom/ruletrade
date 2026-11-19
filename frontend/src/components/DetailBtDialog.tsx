import { useMemo, useState, type FormEvent } from "react";

import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "../domain/backtest";
import { researchExperimentApi, type CatalogBaseRequest, type DetailExperimentExecution } from "../researchExperimentApi";

function parseValues(raw: string, sample: unknown): unknown[] {
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (typeof sample === "number") return values.map(Number);
  return values.map((item) => item.toUpperCase());
}

const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
const percent = (value: string | number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value));

export function DetailBtDialog({ revisionId, base, onClose, onOpenRun }: {
  revisionId: string;
  base: CatalogBaseRequest | null;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const parameters = useMemo(() => base ? Object.keys(base).filter((key) => !["catalog_id", "version", "name"].includes(key) && !Array.isArray(base[key])) : [], [base]);
  const [parameter, setParameter] = useState(parameters[0] ?? "");
  const [values, setValues] = useState(parameter && base ? String(base[parameter]) : "");
  const [name, setName] = useState("Detail parameter comparison");
  const [config, setConfig] = useState<BacktestConfig>(DEFAULT_BACKTEST_CONFIG);
  const [state, setState] = useState<"setup" | "running" | "error" | "success">("setup");
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<DetailExperimentExecution | null>(null);
  const chooseParameter = (next: string) => { setParameter(next); setValues(base ? String(base[next]) : ""); };
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!base || !parameter) return;
    setState("running"); setError("");
    try {
      const parsed = parseValues(values, base[parameter]);
      if (parsed.length === 0 || parsed.some((item) => typeof item === "number" && !Number.isFinite(item))) throw new Error("Enter at least one valid value.");
      const result = await researchExperimentApi.createDetail(revisionId, { name, base, dimensions: [{ parameter_id: parameter, values: parsed }], config });
      setExecution(result); setState("success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Detail BT could not complete."); setState("error");
    }
  };
  return <div className="modal-backdrop detail-bt-backdrop" role="presentation"><section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-bt-title">
    <header><div><span className="eyebrow">Research backtest</span><h2 id="detail-bt-title">Detail BT</h2><p>Run several parameter values against the same saved Revision and compare the official LEAN results.</p></div><button type="button" className="close-button" aria-label="Close Detail BT" onClick={onClose}>×</button></header>
    {!base ? <div className="empty-state"><h3>This strategy has no fixed-rule parameter record</h3><p>Create a new strategy from the tested Rules catalog to use Detail BT. General Builder parameter bindings remain a separate track.</p></div> : state !== "success" || !execution ? <form className="create-dialog detail-bt-form" onSubmit={(event) => void run(event)}>
      <label>Experiment name<input aria-label="Experiment name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Parameter<select aria-label="Detail parameter" value={parameter} onChange={(event) => chooseParameter(event.target.value)}>{parameters.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Values<input aria-label="Detail values" value={values} onChange={(event) => setValues(event.target.value)} placeholder="QQQ, SPY, TLT" /><small>Comma-separated values. At most 32 Candidate runs.</small></label>
      <div className="detail-bt-config">
        <label>Start date<input aria-label="Detail start date" type="date" value={config.start_date} onChange={(event) => setConfig({ ...config, start_date: event.target.value })} /></label>
        <label>End date<input aria-label="Detail end date" type="date" value={config.end_date} onChange={(event) => setConfig({ ...config, end_date: event.target.value })} /></label>
        <label>Initial cash<input aria-label="Detail initial cash" value={config.initial_cash} onChange={(event) => setConfig({ ...config, initial_cash: event.target.value })} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={state === "running" || !parameter || !name.trim()}>{state === "running" ? "Running candidates…" : "Run Detail BT"}</button></div>
    </form> : <div className="detail-bt-results">
      <div className="detail-bt-result-header"><div><span className="eyebrow">Completed experiment</span><h3>{execution.experiment.name}</h3></div><button className="secondary-button" type="button" onClick={() => { setExecution(null); setState("setup"); }}>New comparison</button></div>
      <table><thead><tr><th>Candidate</th><th>Parameters</th><th>Status</th><th>Total return</th><th>Final value</th><th>Orders</th><th /></tr></thead><tbody>{execution.experiment.candidates.map((candidate, index) => { const run = execution.runs[index]; return <tr key={candidate.id}><td>#{candidate.ordinal}</td><td><code>{JSON.stringify(candidate.parameters)}</code></td><td>{run?.status ?? "missing"}</td><td>{run?.result ? percent(run.result.total_return) : "—"}</td><td>{run?.result ? money(run.result.final_value) : "—"}</td><td>{run?.result?.total_orders ?? "—"}</td><td>{run && onOpenRun && <button type="button" className="text-button" onClick={() => onOpenRun(run.id)}>Open result</button>}</td></tr>; })}</tbody></table>
    </div>}
  </section></div>;
}
