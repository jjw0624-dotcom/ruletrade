import { useEffect, useState, type FormEvent } from "react";

import {
  researchExperimentApi,
  type HiddenDatasetPolicy,
  type HiddenExperimentExecution,
} from "../researchExperimentApi";

const money = (value: string | number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(Number(value));
const percent = (value: string | number) => new Intl.NumberFormat("en-US", {
  style: "percent", maximumFractionDigits: 2,
}).format(Number(value));

export function HiddenBtDialog({ revisionId, onClose, onOpenRun }: {
  revisionId: string;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const [policies, setPolicies] = useState<HiddenDatasetPolicy[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [name, setName] = useState("Hidden holdout evaluation");
  const [state, setState] = useState<"loading" | "setup" | "running" | "error" | "success">("loading");
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<HiddenExperimentExecution | null>(null);

  useEffect(() => {
    let active = true;
    void researchExperimentApi.hiddenPolicies().then(({ items }) => {
      if (!active) return;
      setPolicies(items);
      setPolicyId(items[0]?.id ?? "");
      setState("setup");
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Hidden BT policies could not be loaded.");
      setState("error");
    });
    return () => { active = false; };
  }, []);

  const policy = policies.find((item) => item.id === policyId) ?? null;
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!policyId) return;
    setState("running"); setError("");
    try {
      const result = await researchExperimentApi.createHidden(revisionId, {
        name: name.trim(),
        policy_id: policyId,
      });
      setExecution(result);
      setState("success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hidden BT could not complete.");
      setState("error");
    }
  };

  const resultRow = (label: string, runResult: HiddenExperimentExecution["calibration_run"], dates: { start_date: string; end_date: string }) =>
    <tr><td>{label}</td><td>{dates.start_date} – {dates.end_date}</td><td>{runResult.status}</td>
      <td>{runResult.result ? percent(runResult.result.total_return) : "—"}</td>
      <td>{runResult.result ? money(runResult.result.final_value) : "—"}</td>
      <td>{runResult.result?.total_orders ?? "—"}</td>
      <td>{onOpenRun && <button type="button" className="text-button" onClick={() => onOpenRun(runResult.id)}>Open result</button>}</td>
    </tr>;

  return <div className="modal-backdrop detail-bt-backdrop" role="presentation"><section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="hidden-bt-title">
    <header><div><span className="eyebrow">Out-of-sample research</span><h2 id="hidden-bt-title">Hidden BT</h2><p>Evaluate the unchanged saved Revision on a server-owned holdout. Dates and data cannot be supplied by the strategy author.</p></div><button type="button" className="close-button" aria-label="Close Hidden BT" onClick={onClose}>×</button></header>
    {state !== "success" || !execution ? <form className="create-dialog detail-bt-form" onSubmit={(event) => void run(event)}>
      <label>Experiment name<input aria-label="Hidden experiment name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Evaluation policy<select aria-label="Hidden evaluation policy" value={policyId} disabled={state === "loading"} onChange={(event) => setPolicyId(event.target.value)}>{policies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {policy && <section className="empty-state" aria-label="Server-owned holdout policy"><h3>{policy.name}</h3><p>{policy.description}</p><dl>
        <div><dt>Calibration</dt><dd>{policy.calibration.start_date} – {policy.calibration.end_date}</dd></div>
        <div><dt>Hidden evaluation</dt><dd>{policy.evaluation.start_date} – {policy.evaluation.end_date}</dd></div>
        <div><dt>Dataset</dt><dd>{policy.dataset_id}</dd></div>
      </dl><small>This policy is read-only. Both partitions execute as normal official LEAN Runs.</small></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={state === "loading" || state === "running" || !policyId || !name.trim()}>{state === "running" ? "Running holdout…" : "Run Hidden BT"}</button></div>
    </form> : <div className="detail-bt-results">
      <div className="detail-bt-result-header"><div><span className="eyebrow">Completed holdout</span><h3>{execution.experiment.name}</h3></div><button className="secondary-button" type="button" onClick={() => { setExecution(null); setState("setup"); }}>Run again</button></div>
      <section className="empty-state" aria-label="Generalization gap"><span className="eyebrow">Calibration − hidden return</span><h3>{execution.generalization_gap === null ? "Unavailable" : percent(execution.generalization_gap)}</h3><p>A positive value means performance declined on the hidden period.</p></section>
      <table><thead><tr><th>Partition</th><th>Period</th><th>Status</th><th>Total return</th><th>Final value</th><th>Orders</th><th /></tr></thead><tbody>
        {resultRow("Calibration", execution.calibration_run, execution.policy.calibration)}
        {resultRow("Hidden", execution.hidden_run, execution.policy.evaluation)}
      </tbody></table>
    </div>}
  </section></div>;
}
