import { useEffect, useMemo, useState } from "react";
import { backtestRunApi, type BacktestRunRecord } from "../backtestRunApi";
import { comparisonApi, type BehaviorDifference, type ComparisonRecord, type DecisionContextDiff } from "../comparisonApi";
import type { DecisionEvidence, DecisionEventDetail } from "../decisionEvidenceApi";
import type { ResearchContext } from "../domain/researchContext";

type Props = {
  comparisonId: string;
  initialContext?: ResearchContext | null;
  onOpenRun: (runId: string, context?: ResearchContext) => void;
  onViewRule?: (revisionId: string, componentId: string, fieldPath: string, context: ResearchContext) => void;
};
const percent = (value: string | number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2, signDisplay: Number(value) === 0 ? "never" : "auto" }).format(Number(value));
const money = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
const shortDay = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ComparisonWorkspace({ comparisonId, initialContext, onOpenRun, onViewRule }: Props) {
  const [comparison, setComparison] = useState<ComparisonRecord | null>(null);
  const [runs, setRuns] = useState<{ original: BacktestRunRecord; candidate: BacktestRunRecord } | null>(null);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ context: DecisionContextDiff; difference: BehaviorDifference } | null>(null);
  useEffect(() => {
    let cancelled = false; setState("loading"); setError("");
    comparisonApi.get(comparisonId).then(async (record) => {
      const [original, candidate] = await Promise.all([backtestRunApi.get(record.original_run_id), backtestRunApi.get(record.candidate_run_id)]);
      if (cancelled) return;
      setComparison(record); setRuns({ original, candidate });
      setSelected(selectInitialDifference(record, initialContext)); setState("loaded");
    }).catch((reason: unknown) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "We couldn't open this comparison."); setState("error"); } });
    return () => { cancelled = true; };
  }, [comparisonId, initialContext]);
  if (state === "loading") return <main className="page comparison-page"><div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening comparison…</h1><p>Loading the saved research artifacts. No backtest is being rerun.</p></div></main>;
  if (state === "error" || !comparison || !runs) return <main className="page comparison-page"><div className="page-state error-state" role="alert"><h1>We couldn't open this comparison</h1><p>{error}</p></div></main>;
  const context = selected?.context;
  const researchContext = context ? { runId: comparison.original_run_id, sessionId: context.session_id, asset: selected ? differenceAsset(selected.difference) : null } : undefined;
  return <main className="page comparison-page"><header className="workspace-heading compare-heading"><div><span className="eyebrow">Comparison</span><h1>See what your change actually affected</h1><p>Original and Candidate used the same test settings. Your saved strategy is unchanged.</p></div><nav className="compare-nav" aria-label="Comparison views"><button className="secondary-button" onClick={() => onOpenRun(comparison.original_run_id, researchContext)}>Original result</button><button className="secondary-button" onClick={() => onOpenRun(comparison.candidate_run_id)}>Candidate result</button></nav></header>
    <section className="comparison-change"><span className="eyebrow">You changed</span><h2>Return threshold</h2><div className="before-after"><div><span>Original</span><strong>&gt; {percent(comparison.strategy_diff.before)}</strong></div><span aria-hidden="true">→</span><div><span>Candidate</span><strong>&gt; {percent(comparison.strategy_diff.after)}</strong></div></div>{onViewRule && researchContext && <button className="text-button" onClick={() => onViewRule(runs.original.revision_id, comparison.strategy_diff.component_id, comparison.strategy_diff.field_path, researchContext)}>View rule</button>}</section>
    <section className="comparison-behavior"><header><div><span className="eyebrow">Behavior</span><h2>{comparison.changed_decision_contexts.length} decision {comparison.changed_decision_contexts.length === 1 ? "context" : "contexts"} changed</h2><p>These are strategy decisions—not necessarily trades or orders.</p></div><span className="difference-filter" aria-label="Only differences enabled">✓ Only differences</span></header>
      {comparison.changed_decision_contexts.length === 0 ? <div className="zero-differences"><h3>This change did not alter any strategy decisions during this test period.</h3><p>That is useful evidence: this threshold did not affect behavior in the dates tested.</p></div> : <div className="compare-research-layout"><aside className="difference-list" aria-label="Changed decisions">{comparison.changed_decision_contexts.map((item) => <button key={item.session_id} className={context?.session_id === item.session_id ? "difference-item selected" : "difference-item"} onClick={() => setSelected({ context: item, difference: item.differences[0] })}><time>{shortDay(item.session_id)}</time><strong>{contextLabel(item)}</strong><small>{item.differences.length} {item.differences.length === 1 ? "change" : "changes"}</small></button>)}</aside>{selected && <WhyDifferent selected={selected} strategyDiff={comparison.strategy_diff} onSelect={(difference) => setSelected({ context: selected.context, difference })} onViewRule={onViewRule ? () => onViewRule(runs.original.revision_id, comparison.strategy_diff.component_id, comparison.strategy_diff.field_path, researchContext!) : undefined} />}</div>}
    </section>
    <PortfolioDifference comparison={comparison} />
    <ResultDifference comparison={comparison} runs={runs} />
    <details className="run-details"><summary>Comparison details</summary><dl><div><dt>Created</dt><dd>{new Date(comparison.created_at).toLocaleString()}</dd></div><div><dt>Evidence records aligned</dt><dd>{comparison.aligned_evidence_records}</dd></div><div><dt>Comparison time</dt><dd>{comparison.compute_ms} ms</dd></div></dl></details>
  </main>;
}

function WhyDifferent({ selected, strategyDiff, onSelect, onViewRule }: { selected: { context: DecisionContextDiff; difference: BehaviorDifference }; strategyDiff: ComparisonRecord["strategy_diff"]; onSelect: (difference: BehaviorDifference) => void; onViewRule?: () => void }) {
  const asset = differenceAsset(selected.difference);
  return <article className="why-different"><header><span className="eyebrow">Why different?</span><h3>{shortDay(selected.context.session_id)}{asset ? ` · ${asset}` : ""}</h3><p>Changing the threshold changed this deterministic strategy decision.</p></header>{selected.context.differences.length > 1 && <div className="difference-tabs">{selected.context.differences.map((difference) => <button key={difference.key} className={difference.key === selected.difference.key ? "selected" : ""} onClick={() => onSelect(difference)}>{differenceLabel(difference)}</button>)}</div>}<div className="comparison-rule"><span>Return threshold</span><strong>{percent(strategyDiff.before)} → {percent(strategyDiff.after)}</strong>{onViewRule && <button className="text-button" onClick={onViewRule}>View rule</button>}</div><div className="side-by-side"><EventResolution title="Original" event={selected.difference.original_event} /><EventResolution title="Candidate" event={selected.difference.candidate_event} /></div><ul className="difference-causes">{selected.difference.kinds.map((kind) => <li key={kind}><span aria-hidden="true">{kind === "fallback_activation_changed" ? "◆" : "↳"}</span>{kindLabel(kind)}</li>)}</ul></article>;
}

function EventResolution({ title, event }: { title: string; event: DecisionEventDetail | null }) {
  if (!event) return <section className="resolution-card unavailable"><h4>{title}</h4><p>— This event was not present.</p></section>;
  const evidence = event.evidence;
  return <section className="resolution-card"><h4>{title}</h4><strong>{evidenceLabel(evidence)}</strong>{evidenceFacts(evidence).map((fact) => <p key={fact}>{fact}</p>)}</section>;
}

function PortfolioDifference({ comparison }: { comparison: ComparisonRecord }) {
  const pair = comparison.changed_decision_contexts.flatMap((context) => context.differences).find((difference) => difference.kinds.includes("final_target_changed") && difference.original_event?.evidence.kind === "final_targets" && difference.candidate_event?.evidence.kind === "final_targets");
  if (!pair || pair.original_event?.evidence.kind !== "final_targets" || pair.candidate_event?.evidence.kind !== "final_targets") return null;
  return <section className="portfolio-comparison"><span className="eyebrow">Portfolio</span><h2>Final allocation changed</h2><div className="allocation-compare"><TargetBars title="Original" targets={pair.original_event.evidence.targets} /><TargetBars title="Candidate" targets={pair.candidate_event.evidence.targets} /></div></section>;
}
function TargetBars({ title, targets }: { title: string; targets: Record<string, string> }) { return <div><h3>{title}</h3>{Object.entries(targets).map(([asset, value]) => <div className="comparison-bar" key={asset}><strong>{asset}</strong><span><i style={{ width: `${Math.max(0, Math.min(100, Number(value) * 100))}%` }} /></span><b>{percent(value)}</b></div>)}</div>; }

function ResultDifference({ comparison, runs }: { comparison: ComparisonRecord; runs: { original: BacktestRunRecord; candidate: BacktestRunRecord } }) {
  const metrics: Array<{ label: string; original: string; candidate: string; delta: string }> = [
    { label: "Final value", original: money(comparison.result_diff.final_value.original), candidate: money(comparison.result_diff.final_value.candidate), delta: money(comparison.result_diff.final_value.delta) },
    { label: "Total return", original: percent(comparison.result_diff.total_return.original), candidate: percent(comparison.result_diff.total_return.candidate), delta: percent(comparison.result_diff.total_return.delta) },
    { label: "Orders", original: String(comparison.result_diff.total_orders.original), candidate: String(comparison.result_diff.total_orders.candidate), delta: String(comparison.result_diff.total_orders.delta) },
    { label: "Fees", original: money(comparison.result_diff.total_fees.original), candidate: money(comparison.result_diff.total_fees.candidate), delta: money(comparison.result_diff.total_fees.delta) },
  ];
  return <section className="result-difference"><span className="eyebrow">Result</span><h2>What changed in the outcome</h2><div className="result-diff-table" role="table" aria-label="Result difference"><div role="row"><span role="columnheader">Metric</span><span role="columnheader">Original</span><span role="columnheader">Candidate</span><span role="columnheader">Change</span></div>{metrics.map(({ label, original, candidate, delta }) => <div role="row" key={label}><strong role="rowheader">{label}</strong><span role="cell">{original}</span><span role="cell">{candidate}</span><b role="cell">{delta}</b></div>)}</div>{runs.original.result && runs.candidate.result && <EquityComparison original={runs.original.result.equity_curve} candidate={runs.candidate.result.equity_curve} />}</section>;
}

function EquityComparison({ original, candidate }: { original: Array<{ timestamp: string; value: string }>; candidate: Array<{ timestamp: string; value: string }> }) {
  if (original.length < 2 || candidate.length < 2) return null;
  const width=900,height=240,padding=24; const values=[...original,...candidate].map((point)=>Number(point.value)); const min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const points=(curve: typeof original)=>curve.map((point,index)=>`${padding+(index/Math.max(curve.length-1,1))*(width-padding*2)},${height-padding-((Number(point.value)-min)/range)*(height-padding*2)}`).join(" ");
  return <div className="equity-comparison"><div className="equity-legend"><span><i className="original" />Original</span><span><i className="candidate" />Candidate</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Original and Candidate portfolio values over the same test period"><line x1={padding} y1={height-padding} x2={width-padding} y2={height-padding} /><polyline className="original" points={points(original)} /><polyline className="candidate" points={points(candidate)} /></svg></div>;
}

export function selectInitialDifference(comparison: ComparisonRecord, context?: ResearchContext | null) {
  const wanted = context ? comparison.changed_decision_contexts.find((item) => item.session_id === context.sessionId) : undefined;
  if (wanted) { const assetMatch = context?.asset ? wanted.differences.find((item) => differenceAsset(item) === context.asset) : undefined; return { context: wanted, difference: assetMatch ?? wanted.differences[0] }; }
  const first = comparison.first_difference; const firstContext = first ? comparison.changed_decision_contexts.find((item) => item.session_id === first.session_id) : comparison.changed_decision_contexts[0];
  if (!firstContext) return null;
  return { context: firstContext, difference: firstContext.differences.find((item) => item.key === first?.difference_key) ?? firstContext.differences[0] };
}
function contextLabel(context: DecisionContextDiff): string { return differenceLabel(context.differences[0]); }
function differenceLabel(difference: BehaviorDifference): string { return difference.kinds.map(kindLabel).join(" · "); }
function kindLabel(kind: string): string { const labels: Record<string,string> = { event_presence_changed: "Decision step appeared or disappeared", qualification_changed: "Qualification changed", rank_changed: "Ranking changed", candidate_membership_changed: "Candidate set changed", primary_selection_changed: "Selected assets changed", fallback_activation_changed: "Fallback use changed", cooldown_eligibility_changed: "Waiting-period eligibility changed", final_selection_changed: "Final selection changed", snapshot_targets_changed: "Saved sleeve choices changed", snapshot_usage_changed: "Sleeve timing changed", sleeve_contribution_changed: "Sleeve contribution changed", state_mutation_changed: "Waiting-period state changed", final_target_changed: "Final allocation changed" }; return labels[kind] ?? "Decision changed"; }
function differenceAsset(difference: BehaviorDifference): string | null { const evidence = difference.original_event?.evidence ?? difference.candidate_event?.evidence; if (!evidence) return null; if (evidence.kind === "fallback" || evidence.kind === "cooldown" || evidence.kind === "state_mutation") return evidence.asset; if (evidence.kind === "filter") { const left = difference.original_event?.evidence; const right = difference.candidate_event?.evidence; if (left?.kind === "filter" && right?.kind === "filter") return left.evaluations.find((item) => right.evaluations.find((other) => other.asset === item.asset)?.passed !== item.passed)?.asset ?? null; } return null; }
function evidenceLabel(evidence: DecisionEvidence): string { if (evidence.kind === "filter") return "Qualification"; if (evidence.kind === "selection") return "Choose assets"; if (evidence.kind === "fallback") return "Otherwise"; if (evidence.kind === "cooldown") return "Waiting period"; if (evidence.kind === "final_targets") return "Final portfolio"; if (evidence.kind === "sleeve_contribution") return "Portfolio contribution"; return evidence.kind.replaceAll("_", " "); }
function evidenceFacts(evidence: DecisionEvidence): string[] { if (evidence.kind === "filter") return [`Needed > ${percent(evidence.threshold)}`, ...evidence.evaluations.map((item) => `${item.asset}: ${percent(item.observed)} · ${item.passed ? "✓ Qualified" : "✕ Didn't qualify"}`)]; if (evidence.kind === "selection") return [`Selected: ${evidence.primary_selected.join(" + ") || "none"}`]; if (evidence.kind === "fallback") return [`${evidence.activated ? "◆ Used" : "— Not used"}: ${evidence.asset}`]; if (evidence.kind === "cooldown") return [`${evidence.eligible ? "✓ Eligible" : "✕ Blocked"}`, `${evidence.elapsed_completed_sessions ?? 0} of ${evidence.required_completed_sessions} sessions`]; if (evidence.kind === "final_targets") return Object.entries(evidence.targets).map(([asset, value]) => `${asset} ${percent(value)}`); return []; }
