import { useEffect, useMemo, useState, type FormEvent } from "react";

import { researchExperimentApi, type CatalogBaseRequest, type HiddenDatasetPolicy, type HiddenExperimentExecution } from "../researchExperimentApi";

const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
const percent = (value: string | number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value));
function parseValues(raw: string, sample: unknown): unknown[] {
  const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return typeof sample === "number" ? values.map(Number) : values.map((item) => item.toUpperCase());
}

export function HiddenBtDialog({ revisionId, base, onClose, onOpenRun }: {
  revisionId: string;
  base: CatalogBaseRequest | null;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const parameters = useMemo(() => base ? Object.keys(base).filter((key) => !["catalog_id", "version", "name"].includes(key) && !Array.isArray(base[key])) : [], [base]);
  const [parameter, setParameter] = useState(parameters[0] ?? "");
  const [values, setValues] = useState(parameter && base ? String(base[parameter]) : "");
  const [policies, setPolicies] = useState<HiddenDatasetPolicy[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [name, setName] = useState("Hidden parameter selection");
  const [state, setState] = useState<"loading" | "setup" | "running" | "error" | "success">("loading");
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<HiddenExperimentExecution | null>(null);

  useEffect(() => {
    let active = true;
    void researchExperimentApi.hiddenPolicies().then(({ items }) => {
      if (active) { setPolicies(items); setPolicyId(items[0]?.id ?? ""); setState("setup"); }
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Hidden BT policies could not be loaded."); setState("error"); }
    });
    return () => { active = false; };
  }, []);

  const policy = policies.find((item) => item.id === policyId) ?? null;
  const chooseParameter = (next: string) => { setParameter(next); setValues(base ? String(base[next]) : ""); };
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!base || !parameter || !policyId) return;
    setState("running"); setError("");
    try {
      const parsed = parseValues(values, base[parameter]);
      if (parsed.length === 0 || parsed.some((item) => typeof item === "number" && !Number.isFinite(item))) throw new Error("Enter at least one valid value.");
      const result = await researchExperimentApi.createHidden(revisionId, {
        name: name.trim(), policy_id: policyId, base,
        dimensions: [{ parameter_id: parameter, values: parsed }],
      });
      setExecution(result); setState("success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hidden BT could not complete."); setState("error");
    }
  };

  return <div className="modal-backdrop detail-bt-backdrop" role="presentation"><section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="hidden-bt-title">
    <header><div><span className="eyebrow">Overfitting-aware tuning</span><h2 id="hidden-bt-title">Hidden BT</h2><p>Compare parameter candidates on calibration data, select the winner, then evaluate that winner once on a server-owned hidden period.</p></div><button type="button" className="close-button" aria-label="Close Hidden BT" onClick={onClose}>×</button></header>
    {!base ? <div className="empty-state"><h3>Hidden tuning needs a tested Rules strategy</h3><p>The MVP tunes explicit catalog parameters. General Builder parameter bindings remain a separate track.</p></div> : state !== "success" || !execution ? <form className="create-dialog detail-bt-form" onSubmit={(event) => void run(event)}>
      <label>Experiment name<input aria-label="Hidden experiment name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Parameter<select aria-label="Hidden parameter" value={parameter} onChange={(event) => chooseParameter(event.target.value)}>{parameters.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Candidate values<input aria-label="Hidden values" value={values} onChange={(event) => setValues(event.target.value)} /><small>Comma-separated; at most 32 calibration candidates.</small></label>
      <label>Holdout policy<select aria-label="Hidden evaluation policy" value={policyId} disabled={state === "loading"} onChange={(event) => setPolicyId(event.target.value)}>{policies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {policy && <section className="empty-state" aria-label="Server-owned holdout policy"><h3>{policy.name}</h3><p>{policy.description}</p><p>Calibration: {policy.calibration.start_date} – {policy.calibration.end_date}</p><p>Hidden period remains read-only: {policy.evaluation.start_date} – {policy.evaluation.end_date}</p></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={state === "loading" || state === "running" || !parameter || !policyId || !name.trim()}>{state === "running" ? "Selecting and evaluating…" : "Run Hidden BT"}</button></div>
    </form> : <div className="detail-bt-results">
      <div className="detail-bt-result-header"><div><span className="eyebrow">Completed hidden selection</span><h3>{execution.experiment.name}</h3></div><button className="secondary-button" type="button" onClick={() => { setExecution(null); setState("setup"); }}>Run again</button></div>
      <section className="empty-state"><span className="eyebrow">Selected candidate #{execution.selected_candidate_ordinal}</span><h3>{execution.generalization_gap === null ? "Hidden result unavailable" : `${percent(execution.generalization_gap)} calibration − hidden gap`}</h3><p>The hidden result was not used to choose the parameter.</p></section>
      <table><thead><tr><th>Candidate</th><th>Parameters</th><th>Calibration return</th><th>Status</th><th /></tr></thead><tbody>{execution.experiment.candidates.map((candidate, index) => { const item = execution.calibration_runs[index]; return <tr key={candidate.id}><td>#{candidate.ordinal}{candidate.ordinal === execution.selected_candidate_ordinal ? " · selected" : ""}</td><td><code>{JSON.stringify(candidate.parameters)}</code></td><td>{item?.result ? percent(item.result.total_return) : "—"}</td><td>{item?.status ?? "missing"}</td><td>{item && onOpenRun && <button type="button" className="text-button" onClick={() => onOpenRun(item.id)}>Open</button>}</td></tr>; })}</tbody></table>
      <section className="empty-state"><h3>Selected candidate hidden result</h3><p>{execution.hidden_run.result ? `${percent(execution.hidden_run.result.total_return)} · ${money(execution.hidden_run.result.final_value)}` : execution.hidden_run.status}</p>{onOpenRun && <button type="button" className="text-button" onClick={() => onOpenRun(execution.hidden_run.id)}>Open hidden result</button>}</section>
    </div>}
  </section></div>;
}
