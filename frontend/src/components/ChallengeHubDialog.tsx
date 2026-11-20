import { useEffect, useMemo, useState } from "react";

import { challengeApi, type ChallengeDefinition, type ChallengeSubmissionRecord } from "../challengeApi";
import type { StrategyRecord } from "../strategyApi";

const percent = (value: string | number) => new Intl.NumberFormat("en-US", {
  style: "percent", maximumFractionDigits: 2,
}).format(Number(value));

function constraintSummary(challenge: ChallengeDefinition): string[] {
  const constraints = challenge.policy.constraints;
  const items = [
    `Strategy families: ${constraints.allowed_catalog_ids.join(", ")}`,
  ];
  if (constraints.allowed_assets.length) items.push(`Assets: ${constraints.allowed_assets.join(", ")}`);
  for (const [key, value] of Object.entries(constraints.required_parameters)) {
    items.push(`${key}: ${String(value)}`);
  }
  if (constraints.max_total_orders !== null) items.push(`Maximum orders: ${constraints.max_total_orders}`);
  return items;
}

export function ChallengeHubDialog({ strategies, onClose, onCreateStrategy, onOpenStrategy, onOpenRun }: {
  strategies: StrategyRecord[];
  onClose: () => void;
  onCreateStrategy: () => void;
  onOpenStrategy: (strategyId: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  const [challenges, setChallenges] = useState<ChallengeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [revisionId, setRevisionId] = useState(strategies[0]?.current_revision_id ?? "");
  const [submissions, setSubmissions] = useState<ChallengeSubmissionRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "error">("loading");
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<ChallengeSubmissionRecord | null>(null);

  useEffect(() => {
    let active = true;
    void challengeApi.list().then(({ items }) => {
      if (!active) return;
      setChallenges(items); setSelectedId(items[0]?.id ?? ""); setState("ready");
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Challenges could not be loaded."); setState("error"); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLatest(null);
    void challengeApi.submissions(selectedId).then(({ items }) => {
      if (active) setSubmissions(items);
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Submissions could not be loaded."); setState("error"); }
    });
    return () => { active = false; };
  }, [selectedId]);

  const challenge = useMemo(
    () => challenges.find((item) => item.id === selectedId) ?? null,
    [challenges, selectedId],
  );
  const selectedStrategy = strategies.find((item) => item.current_revision_id === revisionId) ?? null;

  const submit = async () => {
    if (!challenge || !revisionId) return;
    setState("submitting"); setError("");
    try {
      const execution = await challengeApi.submit(challenge.id, revisionId);
      setLatest(execution.submission);
      const refreshed = await challengeApi.submissions(challenge.id);
      setSubmissions(refreshed.items);
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Submission could not be evaluated.");
      setState("error");
    }
  };

  return <div className="modal-backdrop detail-bt-backdrop" role="presentation"><section className="creation-picker detail-bt-dialog" role="dialog" aria-modal="true" aria-labelledby="challenge-hub-title">
    <header><div><span className="eyebrow">Problem-first research</span><h2 id="challenge-hub-title">Learning & Competition</h2><p>Choose a server-owned problem, submit an immutable saved Revision, and evaluate it through the official LEAN pipeline.</p></div><button type="button" className="close-button" aria-label="Close Learning and Competition" onClick={onClose}>×</button></header>
    {state === "loading" ? <div className="page-state" role="status"><span className="loading-spinner" /><h3>Loading challenges…</h3></div> : <>
      <div className="representation-switcher" aria-label="Challenge selection">{challenges.map((item) => <button type="button" key={item.id} aria-pressed={item.id === selectedId} className={item.id === selectedId ? "active" : ""} onClick={() => { setSelectedId(item.id); setState("ready"); setError(""); }}>{item.kind === "learning" ? "Learning" : "Competition"}</button>)}</div>
      {challenge && <section className="empty-state" aria-label="Challenge policy"><span className="eyebrow">{challenge.kind} · {challenge.difficulty} · policy v{challenge.policy.version}</span><h3>{challenge.title}</h3><p>{challenge.description}</p><ul>{constraintSummary(challenge).map((item) => <li key={item}>{item}</li>)}</ul><p>Objective: {challenge.policy.objective.direction} {challenge.policy.objective.metric.replace("_", " ")}</p><small>{challenge.policy.config.start_date} – {challenge.policy.config.end_date} · {challenge.policy.config.dataset_id}</small></section>}
      {strategies.length ? <label>Saved strategy<select aria-label="Challenge strategy" value={revisionId} onChange={(event) => setRevisionId(event.target.value)}>{strategies.map((item) => <option key={item.id} value={item.current_revision_id}>{item.name} · {item.current_revision_id.slice(0, 8)}</option>)}</select><small>The current immutable Revision is submitted. Unsaved Builder work is never used.</small></label> : <section className="empty-state"><h3>Create a strategy first</h3><p>Use the fixed Rules catalog, save it, then return here to submit its Revision.</p><button type="button" className="primary-button" onClick={onCreateStrategy}>Create strategy</button></section>}
      {latest && <section className="empty-state" aria-label="Latest challenge result"><span className="eyebrow">Submission recorded</span><h3>{latest.eligible && latest.score !== null ? percent(latest.score) : "Not eligible"}</h3><p>{latest.eligible ? `Official score · Run ${latest.run_id.slice(0, 8)}` : latest.violations.join(" ")}</p><div className="dialog-actions"><button type="button" className="text-button" onClick={() => onOpenRun(latest.run_id)}>Open full result</button>{selectedStrategy && <button type="button" className="text-button" onClick={() => onOpenStrategy(selectedStrategy.id)}>Back to strategy</button>}</div></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {submissions.length > 0 && <div className="detail-bt-results"><h3>{challenge?.kind === "competition" ? "Leaderboard" : "Attempts"}</h3><table><thead><tr><th>Rank</th><th>Revision</th><th>Score</th><th>Eligible</th><th>Run</th></tr></thead><tbody>{submissions.map((item, index) => <tr key={item.id}><td>{item.eligible ? index + 1 : "—"}</td><td>{item.revision_id.slice(0, 8)}</td><td>{item.score === null ? "—" : percent(item.score)}</td><td>{item.eligible ? "Yes" : "No"}</td><td><button type="button" className="text-button" onClick={() => onOpenRun(item.run_id)}>{item.run_id.slice(0, 8)}</button></td></tr>)}</tbody></table></div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Close</button><button type="button" className="primary-button" disabled={!challenge || !selectedStrategy || state === "submitting"} onClick={() => void submit()}>{state === "submitting" ? "Evaluating with LEAN…" : `Submit to ${challenge?.kind === "competition" ? "Competition" : "Learning"}`}</button></div>
    </>}
  </section></div>;
}
