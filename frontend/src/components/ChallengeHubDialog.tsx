import { useEffect, useMemo, useState } from "react";

import { ChallengeApiError, challengeApi, type ChallengeAttemptRecord, type ChallengeDefinition, type ChallengeFeedback, type ChallengeSubmissionRecord } from "../challengeApi";
import type { StrategyRecord } from "../strategyApi";
import { challengeProgress } from "../challengeProgress";

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

export function ChallengeHubDialog({ strategies, onClose, onCreateStrategy, onOpenStrategy, onOpenRun, onOpenSubmission, onReviseStrategy, onSelectChallenge, initialChallengeId = "", initialStrategyId = "", initialAttemptId = "", presentation = "dialog", kind, listOnly = false }: {
  strategies: StrategyRecord[];
  onClose: () => void;
  onCreateStrategy: (challenge: ChallengeDefinition) => void;
  onOpenStrategy: (strategyId: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenSubmission: (submissionId: string) => void;
  onReviseStrategy: (strategyId: string, challengeId: string, feedback: string[]) => void;
  onSelectChallenge?: (challenge: ChallengeDefinition) => void;
  initialChallengeId?: string;
  initialStrategyId?: string;
  initialAttemptId?: string;
  presentation?: "dialog" | "page";
  kind?: "learning" | "competition";
  listOnly?: boolean;
}) {
  const [challenges, setChallenges] = useState<ChallengeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState(initialChallengeId);
  const [revisionId, setRevisionId] = useState(() => strategies.find((item) => item.id === initialStrategyId)?.current_revision_id ?? strategies[0]?.current_revision_id ?? "");
  const [submissions, setSubmissions] = useState<ChallengeSubmissionRecord[]>([]);
  const [attempts, setAttempts] = useState<ChallengeAttemptRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "error">("loading");
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<ChallengeSubmissionRecord | null>(null);
  const [feedback, setFeedback] = useState<ChallengeFeedback[]>([]);

  useEffect(() => {
    let active = true;
    void challengeApi.list().then(({ items }) => {
      if (!active) return;
      const visible = kind ? items.filter((item) => item.kind === kind) : items;
      setChallenges(visible); setSelectedId((current) => visible.some((item) => item.id === current) ? current : visible[0]?.id ?? ""); setState("ready");
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Challenges could not be loaded."); setState("error"); }
    });
    return () => { active = false; };
  }, [kind]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLatest(null); setFeedback([]);
    void Promise.all([
      challengeApi.submissions(selectedId),
      challengeApi.attempts(selectedId),
    ]).then(([submissionList, attemptList]) => {
      if (!active) return;
      setSubmissions(submissionList.items);
      setAttempts(attemptList.items);
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : "Challenge progress could not be loaded."); setState("error"); }
    });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    const preferred = strategies.find((item) => item.id === initialStrategyId);
    if (preferred) setRevisionId(preferred.current_revision_id);
  }, [initialStrategyId, strategies]);

  const challenge = useMemo(
    () => challenges.find((item) => item.id === selectedId) ?? null,
    [challenges, selectedId],
  );
  const selectedStrategy = strategies.find((item) => item.current_revision_id === revisionId) ?? null;
  const latestStrategy = latest ? strategies.find((item) => item.current_revision_id === latest.revision_id) ?? null : null;
  const activeAttempt = selectedStrategy
    ? attempts.find((item) => item.strategy_id === selectedStrategy.id && item.status === "active") ?? null
    : null;
  const progress = useMemo(
    () => latest ? challengeProgress(latest, submissions) : null,
    [latest, submissions],
  );

  const submit = async () => {
    if (!challenge || !revisionId) return;
    setState("submitting"); setError(""); setFeedback([]);
    try {
      const strategy = strategies.find((item) => item.current_revision_id === revisionId);
      const attemptId = activeAttempt?.id || (strategy
        ? (await challengeApi.startAttempt(challenge.id, strategy.id)).id
        : undefined);
      const execution = await challengeApi.submit(challenge.id, revisionId, attemptId);
      setLatest(execution.submission);
      setFeedback(execution.submission.feedback ?? []);
      const [refreshed, refreshedAttempts] = await Promise.all([
        challengeApi.submissions(challenge.id),
        challengeApi.attempts(challenge.id),
      ]);
      setSubmissions(refreshed.items);
      setAttempts(refreshedAttempts.items);
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Submission could not be evaluated.");
      setFeedback(reason instanceof ChallengeApiError ? reason.feedback : []);
      setState("error");
    }
  };

  const pageTitle = kind === "learning" ? "Learning" : kind === "competition" ? "Competitions" : "Learning & Competition";
  return <div className={presentation === "page" ? "challenge-page" : "modal-backdrop detail-bt-backdrop"} role={presentation === "page" ? undefined : "presentation"}><section className={presentation === "page" ? "page challenge-workspace" : "creation-picker detail-bt-dialog"} role={presentation === "page" ? "main" : "dialog"} aria-modal={presentation === "page" ? undefined : true} aria-labelledby="challenge-hub-title">
    <header><div><span className="eyebrow">Problem-first research</span><h2 id="challenge-hub-title">{pageTitle}</h2><p>Read the problem first, build or select a strategy, then submit an immutable saved Revision through the official LEAN pipeline.</p></div><button type="button" className={presentation === "page" ? "text-button" : "close-button"} aria-label={`Close ${pageTitle}`} onClick={onClose}>{presentation === "page" ? "← Home" : "×"}</button></header>
    {state === "loading" ? <div className="page-state" role="status"><span className="loading-spinner" /><h3>Loading challenges…</h3></div> : <>
      <div className="challenge-problem-list" aria-label="Problem selection">{challenges.map((item) => <button type="button" key={item.id} aria-pressed={!listOnly && item.id === selectedId} className={!listOnly && item.id === selectedId ? "active" : ""} onClick={() => { if (onSelectChallenge) onSelectChallenge(item); else { setSelectedId(item.id); setState("ready"); setError(""); } }}><span>{item.kind === "learning" ? "Learning problem" : "Competition"}</span><strong>{item.title}</strong><small>{item.difficulty}</small></button>)}</div>
      {!listOnly && <>
      {challenge && <section className="empty-state" aria-label="Challenge policy"><span className="eyebrow">{challenge.kind} · {challenge.difficulty} · policy v{challenge.policy.version}</span><h3>{challenge.title}</h3><p>{challenge.description}</p><ul>{constraintSummary(challenge).map((item) => <li key={item}>{item}</li>)}</ul><p>Objective: {challenge.policy.objective.direction} {challenge.policy.objective.metric.replace("_", " ")}</p><small>{challenge.policy.config.start_date} – {challenge.policy.config.end_date} · {challenge.policy.config.dataset_id}</small></section>}
      {strategies.length ? <label>Saved strategy<select aria-label="Challenge strategy" value={revisionId} onChange={(event) => setRevisionId(event.target.value)}>{strategies.map((item) => <option key={item.id} value={item.current_revision_id}>{item.name} · {item.current_revision_id.slice(0, 8)}</option>)}</select><small>The current immutable Revision is submitted. Unsaved Builder work is never used.</small></label> : <section className="empty-state"><h3>Create a strategy first</h3><p>Use the fixed Rules catalog, save it, then return here to submit its Revision.</p><button type="button" className="primary-button" disabled={!challenge} onClick={() => { if (challenge) onCreateStrategy(challenge); }}>Create constrained strategy</button></section>}
      {strategies.length > 0 && challenge && <div className="dialog-actions"><button type="button" className="text-button" onClick={() => onCreateStrategy(challenge)}>Create a new strategy for this problem</button></div>}
      {activeAttempt && challenge && selectedStrategy && <section className="empty-state challenge-attempt-card" aria-label="Active challenge attempt"><span className="eyebrow">Work in progress</span><h3>Resume {selectedStrategy.name}</h3><p>This attempt is saved independently from the Builder tab. Continue editing, save a Revision, then return here to submit.</p><small>Attempt {activeAttempt.id.slice(0, 8)} · updated {new Date(activeAttempt.updated_at).toLocaleString()}</small><div className="dialog-actions"><button type="button" className="primary-button" onClick={() => onReviseStrategy(selectedStrategy.id, challenge.id, [])}>Resume in Builder</button></div></section>}
      {latest && <section className="empty-state" aria-label="Latest challenge result"><span className="eyebrow">Submission recorded</span><h3>{latest.eligible && latest.score !== null ? percent(latest.score) : "Not eligible"}</h3><p>{latest.eligible ? `Official score · Run ${latest.run_id.slice(0, 8)}` : latest.violations.join(" ")}</p>{progress && <div className={`challenge-progress ${progress.outcome}`}><strong>{progress.outcome === "improved" ? "Improved" : progress.outcome === "declined" ? "Moved away from the objective" : "Unchanged"} · {progress.delta > 0 ? "+" : ""}{percent(progress.delta)}</strong><small>Compared with Revision {progress.previous.revision_id.slice(0, 8)} of this same Strategy.</small>{progress.changes.length > 0 && <ul>{progress.changes.map((change) => <li key={change.parameter}>{change.parameter}: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</li>)}</ul>}</div>}<div className="dialog-actions"><button type="button" className="text-button" onClick={() => onOpenSubmission(latest.id)}>Open submission</button><button type="button" className="text-button" onClick={() => onOpenRun(latest.run_id)}>Open full result</button>{latestStrategy && <button type="button" className="primary-button" onClick={() => onReviseStrategy(latestStrategy.id, latest.challenge_id, feedback.map((item) => item.message))}>Revise and resubmit</button>}{latestStrategy && <button type="button" className="text-button" onClick={() => onOpenStrategy(latestStrategy.id)}>Open source strategy</button>}</div></section>}
      {feedback.length > 0 && <section className="challenge-feedback" aria-label="Challenge feedback"><span className="eyebrow">What to change next</span><h3>{feedback.some((item) => item.target === "execution" || item.target === "result") ? "Review execution constraints" : "Update the strategy inputs"}</h3><ul>{feedback.map((item, index) => <li key={`${item.code}-${item.parameter ?? index}`}><strong>{item.parameter ? `${item.parameter}: ` : ""}{item.message}</strong>{item.expected !== null && <small>Required: {JSON.stringify(item.expected)}{item.actual !== null ? ` · Submitted: ${JSON.stringify(item.actual)}` : ""}</small>}</li>)}</ul>{!latest && selectedStrategy && challenge && <button type="button" className="primary-button" onClick={() => onReviseStrategy(selectedStrategy.id, challenge.id, feedback.map((item) => item.message))}>Revise to qualify</button>}</section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {submissions.length > 0 && <div className="detail-bt-results"><h3>{challenge?.kind === "competition" ? "Leaderboard" : "Attempts"}</h3><table><thead><tr><th>Rank</th><th>Revision</th><th>Score</th><th>Change</th><th>Eligible</th><th>Submission</th><th>Run</th></tr></thead><tbody>{submissions.map((item, index) => { const itemProgress = challengeProgress(item, submissions); return <tr key={item.id}><td>{item.eligible ? index + 1 : "—"}</td><td>{item.revision_id.slice(0, 8)}</td><td>{item.score === null ? "—" : percent(item.score)}</td><td>{itemProgress ? <span className={`attempt-change ${itemProgress.outcome}`}>{itemProgress.delta > 0 ? "+" : ""}{percent(itemProgress.delta)}</span> : "—"}</td><td>{item.eligible ? "Yes" : "No"}</td><td><button type="button" className="text-button" onClick={() => onOpenSubmission(item.id)}>{item.id.slice(0, 8)}</button></td><td><button type="button" className="text-button" onClick={() => onOpenRun(item.run_id)}>{item.run_id.slice(0, 8)}</button></td></tr>; })}</tbody></table></div>}
      <div className="dialog-actions">{presentation === "dialog" && <button type="button" className="secondary-button" onClick={onClose}>Close</button>}<button type="button" className="primary-button" disabled={!challenge || !selectedStrategy || state === "submitting"} onClick={() => void submit()}>{state === "submitting" ? "Evaluating with LEAN…" : `Submit to ${challenge?.kind === "competition" ? "Competition" : "Learning"}`}</button></div>
      </>}
    </>}
  </section></div>;
}
