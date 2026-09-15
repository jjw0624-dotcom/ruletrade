import type { BacktestRunRecord } from "../backtestRunApi";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LeanBacktestResponse } from "../domain/backtest";
import { BacktestResultPanel } from "./BacktestResultPanel";
import { DecisionAnalysis } from "./DecisionAnalysis";
import { decisionEvidenceApi, type DecisionEventSummary } from "../decisionEvidenceApi";
import { groupDecisionSessions, type DecisionSession } from "../domain/decisionPresentation";
import type { ResearchContext } from "../domain/researchContext";
import type { ComparisonRecord } from "../comparisonApi";

type Props = {
  strategyName: string;
  onBack: () => void;
  response?: LeanBacktestResponse;
  run?: BacktestRunRecord;
  researchContext?: ResearchContext | null;
  onResearchContextChange?: (context: ResearchContext) => void;
  onShowInStrategy?: (revisionId: string, componentId: string, fieldPath: string | null | undefined, context: ResearchContext) => void;
  onViewInFlow?: (revisionId: string, componentId: string, fieldPath: string | null | undefined, context: ResearchContext) => void;
  onComparisonReady?: (comparison: ComparisonRecord, context: ResearchContext) => void;
};

function timestamp(value: string | null): string { return value ? new Date(value).toLocaleString() : "Not completed"; }

export function ResultWorkspace({ response, run, strategyName, onBack, researchContext, onResearchContextChange, onShowInStrategy, onViewInFlow, onComparisonReady }: Props) {
  const [summaries, setSummaries] = useState<DecisionEventSummary[]>([]);
  const [evidenceState, setEvidenceState] = useState<"loading" | "loaded" | "error">(run?.status === "succeeded" ? "loading" : "loaded");
  const [selectedSession, setSelectedSession] = useState<DecisionSession | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  const sessions = useMemo(() => groupDecisionSessions(summaries), [summaries]);
  useEffect(() => { setSummaries([]); setSelectedSession(null); if (run?.status !== "succeeded") { setEvidenceState("loaded"); return; } let cancelled = false; setEvidenceState("loading"); decisionEvidenceApi.list(run.id).then(({ items }) => { if (!cancelled) { setSummaries(items); setEvidenceState("loaded"); } }).catch(() => { if (!cancelled) setEvidenceState("error"); }); return () => { cancelled = true; }; }, [run?.id, run?.status]);
  useEffect(() => { if (!run || !researchContext || researchContext.runId !== run.id || selectedSession || sessions.length === 0) return; const restored = sessions.find((session) => session.sessionId === researchContext.sessionId); if (restored) { setSelectedSession(restored); requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ block: "start" })); } }, [researchContext, run, selectedSession, sessions]);
  function selectDecision(session: DecisionSession, reveal = false) { setSelectedSession(session); if (run) onResearchContextChange?.({ runId: run.id, sessionId: session.sessionId, asset: null }); if (reveal) requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }
  const config = run?.run_config ?? response?.config;
  const result = run?.result ?? response?.result;
  const persistent = Boolean(run);
  return <section className="result-workspace page"><header className="workspace-heading"><div><span className="eyebrow">{persistent ? "Saved test" : "Test of current changes"}</span><h1>{strategyName}</h1>{config && <p>{config.start_date} to {config.end_date}</p>}<span className={`run-kind ${persistent ? "persistent" : "temporary"}`}>{persistent ? "Saved in Backtests" : "Temporary result"}</span></div><button className="secondary-button" onClick={onBack}>Back</button></header>
    {run && run.status === "failed" && <section className="run-failure" role="alert"><span className="eyebrow">Backtest failed</span><h2>This run did not produce a result</h2><p>{run.error?.message ?? "Backtest execution failed."}</p></section>}
    {run && (run.status === "pending" || run.status === "running") && <section className="page-state" role="status"><span className="loading-spinner" /><h2>{run.status === "pending" ? "Waiting to start" : "Testing the strategy"}</h2><p>This saved run has not reached a final result.</p></section>}
    {result && <BacktestResultPanel result={result} selectedTimestamp={selectedSession?.sessionId} decisionSessions={sessions} onSelectDecision={(session) => selectDecision(session, true)} />}
    {run && <details className="run-details"><summary>Run details</summary><dl><div><dt>Revision</dt><dd>{run.revision_id.slice(0, 8)}…</dd></div><div><dt>Status</dt><dd>{run.status}</dd></div><div><dt>Created</dt><dd>{timestamp(run.created_at)}</dd></div><div><dt>Completed</dt><dd>{timestamp(run.completed_at)}</dd></div><div><dt>Backend</dt><dd>{run.provenance.backend_id}</dd></div><div><dt>RuleTrade version</dt><dd>{run.provenance.application_version}</dd></div>{run.provenance.build_commit && <div><dt>Build</dt><dd>{run.provenance.build_commit}</dd></div>}<div><dt>Total execution time</dt><dd>{run.timings.total_ms} ms</dd></div><div><dt>Compiler</dt><dd>{run.timings.compiler_ms} ms</dd></div><div><dt>C# compile</dt><dd>{run.timings.csharp_compile_ms} ms</dd></div><div><dt>LEAN execution</dt><dd>{run.timings.lean_execution_ms} ms</dd></div><div><dt>Normalization</dt><dd>{run.timings.normalization_ms} ms</dd></div></dl></details>}
    {run?.status === "succeeded" ? <div ref={analysisRef}><DecisionAnalysis runId={run.id} sessions={sessions} listState={evidenceState} selected={selectedSession} selectedAsset={researchContext?.runId === run.id && researchContext.sessionId === selectedSession?.sessionId ? researchContext.asset : null} onSelect={selectDecision} onSelectAsset={(asset) => { if (selectedSession) onResearchContextChange?.({ runId: run.id, sessionId: selectedSession.sessionId, asset }); }} onShowInStrategy={onShowInStrategy ? (componentId, fieldPath, asset) => onShowInStrategy(run.revision_id, componentId, fieldPath, { runId: run.id, sessionId: selectedSession!.sessionId, asset }) : undefined} onViewInFlow={onViewInFlow ? (componentId, fieldPath, asset) => onViewInFlow(run.revision_id, componentId, fieldPath, { runId: run.id, sessionId: selectedSession!.sessionId, asset }) : undefined} onComparisonReady={onComparisonReady} /></div> : <section className="analysis-boundary"><div className="analysis-icon">↳</div><div><span className="eyebrow">Analysis</span><h2>Decision analysis is unavailable</h2><p>{run ? "This run did not complete with a result and decision evidence." : "Save this strategy and create a saved test to inspect its decisions."}</p></div></section>}
  </section>;
}
