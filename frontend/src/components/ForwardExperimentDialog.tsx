import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  researchExperimentApi,
  type ForwardExperimentExecution,
  type ResearchExperimentRecord,
} from "../researchExperimentApi";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string | number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(Number(value));

export function ForwardExperimentDialog({ revisionId, onClose, onOpenRun }: {
  revisionId: string;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const [name, setName] = useState("Forward tracking");
  const [startDate, setStartDate] = useState(today);
  const [initialCash, setInitialCash] = useState("100000");
  const [datasetId, setDatasetId] = useState("filter-synthetic");
  const [experiment, setExperiment] = useState<ResearchExperimentRecord | null>(null);
  const [latest, setLatest] = useState<ForwardExperimentExecution["latest_run"] | null>(null);
  const [state, setState] = useState<"loading" | "setup" | "running" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void researchExperimentApi.list(revisionId).then(({ items }) => {
      if (!active) return;
      const existing = items.find((item) => item.kind === "forward") ?? null;
      setExperiment(existing);
      setState(existing ? "ready" : "setup");
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Forward experiments could not be loaded.");
      setState("error");
    });
    return () => { active = false; };
  }, [revisionId]);

  const snapshots = useMemo(
    () => [...(experiment?.candidates ?? [])].sort((left, right) => right.ordinal - left.ordinal),
    [experiment],
  );

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    setState("running");
    setError("");
    try {
      const execution = await researchExperimentApi.createForward(revisionId, {
        name,
        start_date: startDate,
        initial_cash: initialCash,
        dataset_id: datasetId,
      });
      setExperiment(execution.experiment);
      setLatest(execution.latest_run);
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Forward tracking could not be activated.");
      setState("error");
    }
  };

  const refresh = async () => {
    if (!experiment) return;
    setState("running");
    setError("");
    try {
      const execution = await researchExperimentApi.refreshForward(experiment.id);
      setExperiment(execution.experiment);
      setLatest(execution.latest_run);
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Forward snapshot could not be refreshed.");
      setState("error");
    }
  };

  const spec = experiment?.spec ?? {};
  return <div className="modal-backdrop detail-bt-backdrop" role="presentation">
    <section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="forward-title">
      <header>
        <div><span className="eyebrow">Live research</span><h2 id="forward-title">Forward</h2><p>Pin this saved Revision and compare immutable as-of snapshots through official LEAN Runs.</p></div>
        <button type="button" className="close-button" aria-label="Close Forward" onClick={onClose}>×</button>
      </header>
      {!experiment ? <form className="create-dialog detail-bt-form" onSubmit={(event) => void activate(event)}>
        <label>Name<input aria-label="Forward name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
        <div className="parameter-grid">
          <label>Tracking start<input aria-label="Forward start date" type="date" max={today()} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>Initial cash<input aria-label="Forward initial cash" type="number" min="1" step="1" value={initialCash} onChange={(event) => setInitialCash(event.target.value)} /></label>
          <label>Dataset<input aria-label="Forward dataset" value={datasetId} onChange={(event) => setDatasetId(event.target.value)} /></label>
        </div>
        <section className="empty-state"><h3>Revision-pinned tracking</h3><p>Later Builder edits will not rewrite this Forward experiment. Refreshing twice on the same date reuses the existing snapshot.</p></section>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={state === "loading" || state === "running" || !name.trim() || !startDate || Number(initialCash) <= 0}>{state === "running" ? "Activating…" : "Activate Forward"}</button></footer>
      </form> : <div className="detail-bt-results">
        <section className="result-hero">
          <div><span className="eyebrow">Active experiment</span><h3>{experiment.name}</h3><p>Start {String(spec.start_date ?? "—")} · {money(String(spec.initial_cash ?? "0"))} · {String(spec.dataset_id ?? "—")}</p></div>
          <button type="button" className="primary-button" onClick={() => void refresh()} disabled={state === "running"}>{state === "running" ? "Refreshing…" : "Refresh today"}</button>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
        {latest?.result && <section className="empty-state" aria-label="Latest Forward result"><h3>Latest official Run</h3><p>Total return {Number(latest.result.total_return).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 2 })}</p>{onOpenRun && <button type="button" className="secondary-button" onClick={() => onOpenRun(latest.id)}>Open latest Run</button>}</section>}
        <section aria-label="Forward snapshot history"><h3>Snapshot history</h3>{snapshots.length ? <div className="experiment-table"><table><thead><tr><th>As of</th><th>Snapshot</th><th>Run</th></tr></thead><tbody>{snapshots.map((candidate) => <tr key={candidate.id}><td>{String(candidate.parameters.as_of ?? "—")}</td><td>#{candidate.ordinal}</td><td>{candidate.run_id && onOpenRun ? <button type="button" className="text-button" onClick={() => onOpenRun(candidate.run_id!)}>Open Run</button> : candidate.run_id?.slice(0, 8) ?? "Pending"}</td></tr>)}</tbody></table></div> : <p>No snapshots yet.</p>}</section>
        <footer><p>Strategy source {snapshots.at(-1)?.source_hash.slice(0, 10) ?? "—"}… remains pinned.</p><button type="button" className="secondary-button" onClick={onClose}>Done</button></footer>
      </div>}
    </section>
  </div>;
}
