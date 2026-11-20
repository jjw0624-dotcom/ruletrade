import { useEffect, useMemo, useState } from "react";

import {
  researchExperimentApi,
  type ResearchExperimentRecord,
} from "../researchExperimentApi";

type ResearchAction = "detail" | "hidden" | "tests" | "forward";

const labels: Record<ResearchExperimentRecord["kind"], string> = {
  detail: "Detail BT",
  hidden: "Hidden BT",
  robustness: "Robustness",
  random_baseline: "Random Baseline",
  forward: "Forward",
};

export function StrategyResearchHub({ strategyId, currentRevisionId, onClose, onStart, onOpenRun, onOpenHidden }: {
  strategyId: string;
  currentRevisionId: string;
  onClose: () => void;
  onStart: (action: ResearchAction) => void;
  onOpenRun?: (runId: string) => void;
  onOpenHidden?: (experimentId: string) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [experiments, setExperiments] = useState<ResearchExperimentRecord[]>([]);

  useEffect(() => {
    let active = true;
    void researchExperimentApi.listForStrategy(strategyId).then(({ items }) => {
      if (!active) return;
      setExperiments(items);
      setState("ready");
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Strategy research could not be loaded.");
      setState("error");
    });
    return () => { active = false; };
  }, [strategyId]);

  const runCount = useMemo(
    () => experiments.reduce((total, experiment) => total + experiment.candidates.filter((candidate) => candidate.run_id).length, 0),
    [experiments],
  );

  const start = (action: ResearchAction) => {
    onClose();
    onStart(action);
  };

  return <div className="modal-backdrop detail-bt-backdrop" role="presentation">
    <section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="strategy-research-title">
      <header>
        <div><span className="eyebrow">Strategy object</span><h2 id="strategy-research-title">Research</h2><p>Run new evaluation from the current saved Revision or reopen immutable evidence from any prior Revision.</p></div>
        <button type="button" className="close-button" aria-label="Close Research" onClick={onClose}>×</button>
      </header>
      <div className="detail-bt-results">
        <section className="result-hero">
          <div><span className="eyebrow">Saved portfolio</span><h3>{experiments.length} experiments · {runCount} candidate Runs</h3><p>New work starts from Revision {currentRevisionId.slice(0, 8)}…. Existing work remains pinned to its original Revision.</p></div>
        </section>
        <section aria-label="Start strategy research">
          <h3>Start from the current Revision</h3>
          <div className="strategy-cards">
            <button type="button" className="strategy-card" onClick={() => start("detail")}><strong>Detail BT</strong><span>Run one accurate, configurable backtest.</span></button>
            <button type="button" className="strategy-card" onClick={() => start("hidden")}><strong>Hidden BT</strong><span>Evaluate against a server-owned holdout.</span></button>
            <button type="button" className="strategy-card" onClick={() => start("tests")}><strong>Tests</strong><span>Run robustness and random baselines.</span></button>
            <button type="button" className="strategy-card" onClick={() => start("forward")}><strong>Forward</strong><span>Append dated, Revision-pinned snapshots.</span></button>
          </div>
        </section>
        <section aria-label="Saved strategy research">
          <h3>Saved research</h3>
          {state === "loading" && <p role="status">Loading research portfolio…</p>}
          {state === "error" && <p className="form-error" role="alert">{error}</p>}
          {state === "ready" && experiments.length === 0 && <div className="empty-state"><h3>No saved experiments yet</h3><p>Quick Test remains in the Builder. Use one of the research paths above when you want comparable, holdout, robustness, or forward evidence.</p></div>}
          {state === "ready" && experiments.length > 0 && <div className="experiment-table"><table><thead><tr><th>Experiment</th><th>Revision</th><th>Runs</th><th>Latest evidence</th></tr></thead><tbody>{experiments.map((experiment) => {
            const runs = experiment.candidates.flatMap((candidate) => candidate.run_id ? [candidate.run_id] : []);
            const latestRunId = runs.at(-1);
            return <tr key={experiment.id}><td><strong>{experiment.name}</strong><br/><small>{labels[experiment.kind]}</small></td><td>{experiment.revision_id.slice(0, 8)}{experiment.revision_id === currentRevisionId ? " · current" : ""}</td><td>{runs.length}</td><td>{experiment.kind === "hidden" && onOpenHidden ? <button type="button" className="text-button" onClick={() => onOpenHidden(experiment.id)}>Open experiment</button> : latestRunId && onOpenRun ? <button type="button" className="text-button" onClick={() => onOpenRun(latestRunId)}>Open Run</button> : "—"}</td></tr>;
          })}</tbody></table></div>}
        </section>
        <footer><p>Research records are immutable and remain attributable to their source Revision.</p><button type="button" className="secondary-button" onClick={onClose}>Done</button></footer>
      </div>
    </section>
  </div>;
}
