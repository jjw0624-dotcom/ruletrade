import { useEffect, useState } from "react";

import {
  challengeApi,
  type ChallengeDefinition,
  type ChallengeSubmissionRecord,
} from "../challengeApi";

const percent = (value: string | number) => new Intl.NumberFormat("en-US", {
  style: "percent", maximumFractionDigits: 2,
}).format(Number(value));

export function ChallengeSubmissionView({ submissionId, onBack, onOpenChallenge, onOpenRun, onOpenStrategy }: {
  submissionId: string;
  onBack: () => void;
  onOpenChallenge: (challenge: ChallengeDefinition, strategyId?: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenStrategy: (strategyId: string) => void;
}) {
  const [submission, setSubmission] = useState<ChallengeSubmissionRecord | null>(null);
  const [challenge, setChallenge] = useState<ChallengeDefinition | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading"); setError("");
    void challengeApi.getSubmission(submissionId)
      .then(async (record) => ({ record, challenge: await challengeApi.get(record.challenge_id) }))
      .then((result) => {
        if (!active) return;
        setSubmission(result.record); setChallenge(result.challenge); setState("ready");
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Submission could not be loaded.");
        setState("error");
      });
    return () => { active = false; };
  }, [submissionId]);

  if (state === "loading") return <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening submission…</h1><p>Loading its immutable score and execution lineage.</p></div>;
  if (state === "error" || !submission || !challenge) return <div className="page-state error-state" role="alert"><h1>We couldn't open this submission</h1><p>{error}</p><button className="primary-button" onClick={onBack}>Back</button></div>;

  return <main className="page strategy-object-page" aria-label="Challenge submission detail">
    <header className="page-header">
      <button type="button" className="text-button" onClick={() => onOpenChallenge(challenge, submission.strategy_id ?? undefined)}>← {challenge.kind === "learning" ? "Learning problem" : "Competition"}</button>
      <div><span className="eyebrow">Immutable submission</span><h1>{challenge.title}</h1><p>Submission {submission.id.slice(0, 12)}… · {new Date(submission.created_at).toLocaleString()}</p></div>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => onOpenRun(submission.run_id)}>Open full result</button>{submission.strategy_id && <button type="button" className="primary-button" onClick={() => onOpenStrategy(submission.strategy_id!)}>Open strategy</button>}</div>
    </header>

    <section className="result-hero" aria-label="Official submission result">
      <div><span className="eyebrow">{submission.eligible ? "Official score" : "Not eligible"}</span><h2>{submission.eligible && submission.score !== null ? percent(submission.score) : "No score"}</h2><p>{submission.objective.direction} {submission.objective.metric.replace("_", " ")} · Run {submission.run_id.slice(0, 8)}</p></div>
      <span className={`status-badge ${submission.eligible ? "success" : "error"}`}>{submission.eligible ? "Eligible" : "Rejected"}</span>
    </section>

    <section className="strategy-cards" aria-label="Submission lineage">
      <article className="strategy-card"><span className="eyebrow">Revision</span><strong>{submission.revision_id.slice(0, 12)}…</strong><p>The exact immutable strategy version evaluated by LEAN.</p></article>
      <article className="strategy-card"><span className="eyebrow">Policy</span><strong>Challenge v{submission.challenge_version} · policy v{submission.policy_version}</strong><p>The server-owned rules used for this score.</p></article>
      <article className="strategy-card"><span className="eyebrow">Strategy family</span><strong>{submission.catalog_id ?? "Custom strategy"}</strong><p>{Object.keys(submission.catalog_parameters).length} recorded parameters.</p></article>
      <button type="button" className="strategy-card" onClick={() => onOpenRun(submission.run_id)}><span className="eyebrow">Execution</span><strong>Open Run evidence</strong><p>Inspect results and decision evidence without rerunning.</p></button>
    </section>

    {(submission.violations.length > 0 || (submission.feedback?.length ?? 0) > 0) && <section className="challenge-feedback" aria-label="Submission feedback">
      <span className="eyebrow">Judge feedback</span><h2>{submission.eligible ? "Recorded guidance" : "Why this submission did not qualify"}</h2>
      {submission.violations.length > 0 && <ul>{submission.violations.map((item) => <li key={item}>{item}</li>)}</ul>}
      {(submission.feedback ?? []).length > 0 && <ul>{(submission.feedback ?? []).map((item, index) => <li key={`${item.code}-${item.parameter ?? index}`}><strong>{item.parameter ? `${item.parameter}: ` : ""}{item.message}</strong>{item.expected !== null && <small>Required: {JSON.stringify(item.expected)}{item.actual !== null ? ` · Submitted: ${JSON.stringify(item.actual)}` : ""}</small>}</li>)}</ul>}
    </section>}
  </main>;
}
