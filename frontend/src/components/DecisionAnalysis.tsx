import { useEffect, useMemo, useState } from "react";
import { decisionEvidenceApi, type DecisionEventDetail, type DecisionEventSummary, type SourceComponentRef } from "../decisionEvidenceApi";
import { groupDecisionSessions, happenedText, relevantAssets, type DecisionSession } from "../domain/decisionPresentation";

const pct = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value));
const score = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value));
const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function DecisionAnalysis({ runId, onTimestamp, onShowInStrategy }: { runId: string; onTimestamp: (date: string | null) => void; onShowInStrategy?: (componentId: string) => void }) {
  const [summaries, setSummaries] = useState<DecisionEventSummary[]>([]);
  const [listState, setListState] = useState<"loading" | "loaded" | "error">("loading");
  const [selected, setSelected] = useState<DecisionSession | null>(null);
  const [details, setDetails] = useState<DecisionEventDetail[]>([]);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const sessions = useMemo(() => groupDecisionSessions(summaries), [summaries]);

  useEffect(() => {
    let cancelled = false; setListState("loading");
    decisionEvidenceApi.list(runId).then(({ items }) => { if (!cancelled) { setSummaries(items); setListState("loaded"); } }).catch(() => { if (!cancelled) setListState("error"); });
    return () => { cancelled = true; };
  }, [runId]);

  function choose(session: DecisionSession) {
    setSelected(session); setDetailState("loading"); setDetails([]); onTimestamp(session.sessionId);
    Promise.all(session.events.map((event) => decisionEvidenceApi.get(runId, event.id))).then((items) => { setDetails(items.sort((a, b) => a.ordinal - b.ordinal)); setDetailState("loaded"); }).catch(() => setDetailState("error"));
  }

  if (listState === "loading") return <section className="analysis-workspace" aria-label="Decision analysis"><p role="status">Loading decision timeline…</p></section>;
  if (listState === "error") return <section className="analysis-workspace" aria-label="Decision analysis"><div className="analysis-empty" role="alert"><h2>Decision details are unavailable</h2><p>We couldn't load the evidence for this run.</p></div></section>;
  if (summaries.length === 0) return <section className="analysis-workspace" aria-label="Decision analysis"><div className="analysis-empty"><h2>Decision details are not available for this older run</h2><p>The saved result is unchanged. RuleTrade will not invent or rerun missing evidence.</p></div></section>;

  return <section className="analysis-workspace" aria-label="Decision analysis"><header className="analysis-heading"><span className="eyebrow">Analysis</span><h2>Explore this strategy's decisions</h2><p>Select a date to see what happened and which saved rules mattered.</p></header><div className="research-layout"><aside className="decision-timeline" aria-label="Decision timeline"><h3>Decision timeline</h3>{sessions.map((session) => <button key={session.sessionId} className={selected?.sessionId === session.sessionId ? "timeline-event selected" : "timeline-event"} onClick={() => choose(session)} aria-pressed={selected?.sessionId === session.sessionId}><time>{day(session.sessionId)}</time><strong>{session.label}</strong><small>{session.events.length} recorded step{session.events.length === 1 ? "" : "s"}</small></button>)}</aside><div className="research-inspector">{!selected && <div className="inspector-prompt"><h3>Choose a decision</h3><p>Its explanation will stay tied to this historical run.</p></div>}{selected && detailState === "loading" && <p role="status">Opening this decision…</p>}{selected && detailState === "error" && <div role="alert"><h3>We couldn't open this decision</h3><p>The timeline evidence remains unchanged.</p></div>}{selected && detailState === "loaded" && <Inspector details={details} onShowInStrategy={onShowInStrategy} />}</div></div></section>;
}

export function Inspector({ details, onShowInStrategy }: { details: DecisionEventDetail[]; onShowInStrategy?: (componentId: string) => void }) {
  const assets = relevantAssets(details);
  const firstRejected = details.find((item) => item.evidence.kind === "filter")?.evidence;
  const initialAsset = firstRejected?.kind === "filter" ? firstRejected.evaluations.find((item) => !item.passed)?.asset : undefined;
  const [asset, setAsset] = useState(initialAsset ?? assets[0] ?? null);
  const refs = dedupeRefs(details.flatMap((item) => item.source_components));
  return <><section className="inspector-section"><span className="eyebrow">What happened?</span><h3>{happenedText(details)}</h3></section><Why details={details} /><Funnel details={details} /><Sleeves details={details} /><Snapshots details={details} />{assets.length > 0 && <section className="inspector-section"><span className="eyebrow">Why wasn't another asset selected?</span><div className="asset-tabs">{assets.map((item) => <button key={item} onClick={() => setAsset(item)} aria-pressed={asset === item}>{item}</button>)}</div>{asset && <AssetExplanation asset={asset} details={details} />}</section>}<section className="inspector-section"><span className="eyebrow">Strategy rule</span><h3>Rules recorded for this decision</h3><div className="source-list">{refs.map((ref) => <div key={`${ref.role}-${ref.component_id}`}><span>{friendlyRole(ref.role)}</span><code>{ref.component_id}</code>{onShowInStrategy && <button className="secondary-button" onClick={() => onShowInStrategy(ref.component_id)}>Show in strategy</button>}</div>)}</div></section><details className="evidence-details"><summary>Evidence details</summary>{details.map((item) => <div key={item.id}><b>#{item.ordinal} · {item.evidence.kind.replaceAll("_", " ")}</b><span>{item.phase.replaceAll("_", " ")}</span></div>)}</details></>;
}

function Why({ details }: { details: DecisionEventDetail[] }) {
  const selection = details.find((item) => item.evidence.kind === "selection")?.evidence;
  const fallback = details.find((item) => item.evidence.kind === "fallback")?.evidence;
  const final = details.find((item) => item.evidence.kind === "final_selection")?.evidence;
  const cooldown = details.find((item) => item.evidence.kind === "cooldown")?.evidence;
  if (selection?.kind === "selection" && selection.decision === "insufficient" && fallback?.kind === "fallback" && fallback.activated) return <section className="inspector-section"><span className="eyebrow">Why?</span><h3>The primary selection was incomplete.</h3><div className="cause-chain"><span>{selection.candidates.length} candidate{selection.candidates.length === 1 ? "" : "s"} remained</span><i>↓</i><span>Primary selection was insufficient</span><i>↓</i><strong>{fallback.asset} fallback activated</strong>{final?.kind === "final_selection" && <><i>↓</i><strong>Final selection: {final.selected.join(", ")}</strong></>}</div></section>;
  if (cooldown?.kind === "cooldown" && cooldown.signal_candidate && !cooldown.eligible) return <section className="inspector-section"><span className="eyebrow">Why?</span><h3>{cooldown.asset} had a signal, but could not be selected yet.</h3><p>{cooldown.elapsed_completed_sessions ?? 0} of {cooldown.required_completed_sessions} completed trading sessions had passed.</p>{cooldown.last_exit && <p>Its waiting period followed an exit on {day(cooldown.last_exit)}.</p>}</section>;
  return null;
}

export function AssetExplanation({ asset, details }: { asset: string; details: DecisionEventDetail[] }) {
  const filter = details.find((item) => item.evidence.kind === "filter")?.evidence;
  const evaluation = filter?.kind === "filter" ? filter.evaluations.find((item) => item.asset === asset) : undefined;
  const selection = details.find((item) => item.evidence.kind === "selection")?.evidence;
  const cooldown = details.find((item) => item.evidence.kind === "cooldown" && item.evidence.asset === asset)?.evidence;
  return <div className="asset-explanation"><h4>{asset}</h4>{evaluation && filter?.kind === "filter" && <div className={evaluation.passed ? "fact passed" : "fact rejected"}><span>Observed value</span><strong>{score(evaluation.observed)}</strong><span>Required</span><strong>Greater than {score(filter.threshold)}</strong><b>{evaluation.passed ? "Passed the condition" : "Did not pass the condition"}</b></div>}{selection?.kind === "selection" && <div className="stage-list"><span>Filter<strong>{evaluation ? (evaluation.passed ? "Passed" : "Rejected") : "Not recorded"}</strong></span>{selection.ranked.includes(asset) && <span>Ranking<strong>#{selection.ranked.indexOf(asset) + 1}</strong></span>}{selection.candidates.includes(asset) && <span>Candidate<strong>Yes</strong></span>}<span>Primary selection<strong>{selection.primary_selected.includes(asset) ? "Selected" : evaluation?.passed ? "Not selected" : "Stopped earlier"}</strong></span></div>}{cooldown?.kind === "cooldown" && <div className="fact blocked"><span>Signal candidate</span><strong>{cooldown.signal_candidate ? "Yes" : "No"}</strong><span>Waiting period</span><strong>{cooldown.elapsed_completed_sessions ?? 0} / {cooldown.required_completed_sessions} sessions</strong><b>{cooldown.eligible ? "Eligible" : "Blocked by waiting period"}</b></div>}</div>;
}

function Funnel({ details }: { details: DecisionEventDetail[] }) {
  const filter = details.find((item) => item.evidence.kind === "filter")?.evidence;
  const selection = details.find((item) => item.evidence.kind === "selection")?.evidence;
  const final = details.find((item) => item.evidence.kind === "final_selection")?.evidence;
  if (filter?.kind !== "filter" && selection?.kind !== "selection") return null;
  const stages: Array<[string, string]> = [];
  if (filter?.kind === "filter") { stages.push(["Evaluated", String(filter.evaluations.length)]); stages.push(["Qualified", String(filter.evaluations.filter((item) => item.passed).length)]); }
  if (selection?.kind === "selection") { stages.push(["Ranked", String(selection.ranked.length)]); stages.push(["Candidates", String(selection.candidates.length)]); stages.push(["Primary selected", String(selection.primary_selected.length)]); }
  if (final?.kind === "final_selection") stages.push(["Final", final.selected.join(", ") || "None"]);
  return <section className="inspector-section"><span className="eyebrow">Selection path</span><div className="selection-funnel">{stages.map(([label, value], index) => <div key={label}><span>{label}</span><strong>{value}</strong>{index < stages.length - 1 && <i>→</i>}</div>)}</div></section>;
}

export function Sleeves({ details }: { details: DecisionEventDetail[] }) { const items = details.filter((item) => item.evidence.kind === "sleeve_contribution"); const final = details.find((item) => item.evidence.kind === "final_targets")?.evidence; if (!items.length) return null; return <section className="inspector-section"><span className="eyebrow">Portfolio contribution</span><h3>How local sleeve weights became portfolio weights</h3><div className="contribution-list">{items.flatMap((item) => { const evidence = item.evidence; if (evidence.kind !== "sleeve_contribution") return []; return Object.entries(evidence.local_targets).map(([asset, local]) => <div key={`${item.id}-${asset}`}><strong>{asset}</strong><span>{pct(local)} local</span><i>×</i><span>{pct(evidence.allocation)} sleeve</span><i>=</i><b>{pct(evidence.scaled_targets[asset])} portfolio</b></div>); })}{final?.kind === "final_targets" && Object.entries(final.targets).map(([asset, value]) => <div className="final-contribution" key={asset}><strong>Final {asset}</strong><b>{pct(value)}</b></div>)}</div></section>; }

export function Snapshots({ details }: { details: DecisionEventDetail[] }) { const usage = details.find((item) => item.evidence.kind === "snapshot_usage")?.evidence; if (usage?.kind !== "snapshot_usage") return null; return <section className="inspector-section"><span className="eyebrow">Timing</span><h3>This rebalance used the latest saved sleeve targets.</h3><div className="snapshot-list">{Object.entries(usage.snapshots).map(([sleeve, date]) => <div key={sleeve}><span>{sleeve.replaceAll("_", " ")}</span><strong>Last refreshed {day(date)}</strong></div>)}</div></section>; }

function dedupeRefs(refs: SourceComponentRef[]): SourceComponentRef[] { const seen = new Set<string>(); return refs.filter((ref) => { const key = `${ref.role}:${ref.component_id}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function friendlyRole(role: string): string { return role.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase()); }
