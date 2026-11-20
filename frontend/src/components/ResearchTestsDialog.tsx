import { useEffect, useMemo, useState, type FormEvent } from "react";

import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "../domain/backtest";
import { researchExperimentApi, type CatalogBaseRequest, type RobustnessPolicy, type TestExperimentExecution } from "../researchExperimentApi";

const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
const percent = (value: string | number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2, signDisplay: "auto" }).format(Number(value));

export function ResearchTestsDialog({ revisionId, base, experimentId, onClose, onOpenRun }: {
  revisionId: string; base: CatalogBaseRequest | null; experimentId?: string | null; onClose: () => void; onOpenRun?: (runId: string) => void;
}) {
  const [mode, setMode] = useState<"robustness" | "random">("robustness");
  const [policies, setPolicies] = useState<RobustnessPolicy[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [seeds, setSeeds] = useState("7, 11, 23");
  const [config, setConfig] = useState<BacktestConfig>(DEFAULT_BACKTEST_CONFIG);
  const [state, setState] = useState<"loading" | "setup" | "running" | "error" | "success">("loading");
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<TestExperimentExecution | null>(null);
  useEffect(() => {
    let active = true;
    if (experimentId) {
      void researchExperimentApi.getTest(experimentId).then((result) => {
        if (active) {
          setMode(result.experiment.kind === "random_baseline" ? "random" : "robustness");
          setExecution(result);
          setState("success");
        }
      }).catch((reason) => {
        if (active) { setError(reason instanceof Error ? reason.message : "Saved Test could not be loaded."); setState("error"); }
      });
    } else {
      void researchExperimentApi.robustnessPolicies().then(({ items }) => {
        if (active) { setPolicies(items); setPolicyId(items[0]?.id ?? ""); setState("setup"); }
      }).catch((reason) => {
        if (active) { setError(reason instanceof Error ? reason.message : "Test policies could not be loaded."); setState("error"); }
      });
    }
    return () => { active = false; };
  }, [experimentId]);
  const policy = policies.find((item) => item.id === policyId) ?? null;
  const seedValues = useMemo(() => seeds.split(",").map((item) => Number(item.trim())).filter(Number.isInteger), [seeds]);
  const run = async (event: FormEvent) => {
    event.preventDefault(); setState("running"); setError("");
    try {
      const result = mode === "robustness"
        ? await researchExperimentApi.createRobustness(revisionId, { name: "Start-date sensitivity", policy_id: policyId, config })
        : base ? await researchExperimentApi.createRandomBaseline(revisionId, { name: "Seeded random asset baseline", base, seeds: seedValues, config }) : null;
      if (!result) throw new Error("Random Baseline requires a strategy created from the tested Rules catalog.");
      setExecution(result); setState("success");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Research Test could not complete."); setState("error"); }
  };
  const referenceReturn = execution?.runs[0]?.result ? Number(execution.runs[0].result.total_return) : null;
  const returns = execution?.runs.slice(1).flatMap((item) => item.result ? [Number(item.result.total_return)] : []) ?? [];
  return <div className="modal-backdrop detail-bt-backdrop" role="presentation"><section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="research-tests-title">
    <header><div><span className="eyebrow">Strategy evaluation</span><h2 id="research-tests-title">Tests</h2><p>Challenge the saved Revision with reproducible official LEAN Runs.</p></div><button type="button" className="close-button" aria-label="Close Tests" onClick={onClose}>×</button></header>
    {state !== "success" || !execution ? <form className="create-dialog detail-bt-form" onSubmit={(event) => void run(event)}>
      <div className="representation-switcher" aria-label="Research Test type"><button type="button" aria-pressed={mode === "robustness"} className={mode === "robustness" ? "active" : ""} onClick={() => { setMode("robustness"); setState("setup"); }}>Robustness</button><button type="button" aria-pressed={mode === "random"} className={mode === "random" ? "active" : ""} onClick={() => { setMode("random"); setState("setup"); }}>Random Baseline</button></div>
      {mode === "robustness" ? <><label>Policy<select aria-label="Robustness policy" value={policyId} onChange={(event) => setPolicyId(event.target.value)}>{policies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{policy && <section className="empty-state" aria-label="Server-owned robustness policy"><h3>{policy.name}</h3><p>{policy.description}</p><p>Offsets: {policy.start_date_offsets.map((item) => `+${item}d`).join(", ")}</p></section>}</> : <><label>Seeds<input aria-label="Random baseline seeds" value={seeds} onChange={(event) => setSeeds(event.target.value)} /><small>Unique integer seeds; at most 8. Each seed selects one asset from the catalog universe.</small></label>{!base && <p className="form-error" role="alert">Random Baseline requires a tested Rules catalog strategy.</p>}<p className="value-capability-note">Seeded random asset selection; not per-trade probabilistic execution.</p></>}
      <div className="detail-bt-config"><label>Start date<input aria-label="Tests start date" type="date" value={config.start_date} onChange={(event) => setConfig({ ...config, start_date: event.target.value })} /></label><label>End date<input aria-label="Tests end date" type="date" value={config.end_date} onChange={(event) => setConfig({ ...config, end_date: event.target.value })} /></label><label>Initial cash<input aria-label="Tests initial cash" value={config.initial_cash} onChange={(event) => setConfig({ ...config, initial_cash: event.target.value })} /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={state === "loading" || state === "running" || (mode === "robustness" ? !policyId : !base || seedValues.length === 0)}>{state === "running" ? "Running Tests…" : mode === "robustness" ? "Run Robustness" : "Run Random Baseline"}</button></div>
    </form> : <div className="detail-bt-results"><div className="detail-bt-result-header"><div><span className="eyebrow">Completed Test</span><h3>{execution.experiment.name}</h3></div>{!experimentId && <button className="secondary-button" type="button" onClick={() => { setExecution(null); setState("setup"); }}>New Test</button>}</div>{referenceReturn !== null && returns.length > 0 && <section className="empty-state" aria-label="Test distribution summary"><h3>Reference {percent(referenceReturn)}</h3><p>Variants: {percent(Math.min(...returns))} to {percent(Math.max(...returns))}</p></section>}<table><thead><tr><th>Candidate</th><th>Perturbation</th><th>Status</th><th>Total return</th><th>vs reference</th><th>Final value</th><th /></tr></thead><tbody>{execution.experiment.candidates.map((candidate, index) => { const item = execution.runs[index]; const value = item?.result ? Number(item.result.total_return) : null; return <tr key={candidate.id}><td>{index === 0 ? "Reference" : `#${candidate.ordinal}`}</td><td><code>{JSON.stringify(candidate.parameters)}</code></td><td>{item?.status ?? "missing"}</td><td>{value === null ? "—" : percent(value)}</td><td>{value === null || referenceReturn === null ? "—" : percent(value - referenceReturn)}</td><td>{item?.result ? money(item.result.final_value) : "—"}</td><td>{item && onOpenRun && <button type="button" className="text-button" onClick={() => onOpenRun(item.id)}>Open result</button>}</td></tr>; })}</tbody></table></div>}
  </section></div>;
}
