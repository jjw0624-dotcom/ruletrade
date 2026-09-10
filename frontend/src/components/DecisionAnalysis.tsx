import { useEffect, useState } from "react";
import { decisionEvidenceApi, type DecisionEventDetail, type SourceComponentRef } from "../decisionEvidenceApi";
import { assetOutcomes, assetPath, type DecisionSession, type PathStatus } from "../domain/decisionPresentation";

const pct = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value));
const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
type ShowRule = (componentId: string, fieldPath: string | null | undefined, asset: string | null) => void;

export function DecisionAnalysis({ runId, sessions, listState, selected, selectedAsset, onSelect, onSelectAsset, onShowInStrategy }: { runId: string; sessions: DecisionSession[]; listState: "loading" | "loaded" | "error"; selected: DecisionSession | null; selectedAsset?: string | null; onSelect: (session: DecisionSession) => void; onSelectAsset?: (asset: string) => void; onShowInStrategy?: ShowRule }) {
  const [details, setDetails] = useState<DecisionEventDetail[]>([]);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  useEffect(() => {
    if (!selected) { setDetails([]); setDetailState("idle"); return; }
    let cancelled = false; setDetailState("loading"); setDetails([]);
    Promise.all(selected.events.map((event) => decisionEvidenceApi.get(runId, event.id))).then((items) => { if (!cancelled) { setDetails(items.sort((a, b) => a.ordinal - b.ordinal)); setDetailState("loaded"); } }).catch(() => { if (!cancelled) setDetailState("error"); });
    return () => { cancelled = true; };
  }, [runId, selected]);
  if (listState === "loading") return <section className="analysis-workspace" aria-label="Decision analysis"><p role="status">Loading decisions…</p></section>;
  if (listState === "error") return <section className="analysis-workspace" aria-label="Decision analysis"><div className="analysis-empty" role="alert"><h2>Decision details are unavailable</h2><p>We couldn't load them for this saved test.</p></div></section>;
  if (!sessions.length) return <section className="analysis-workspace" aria-label="Decision analysis"><div className="analysis-empty"><h2>Decision details are not available for this older test</h2><p>The saved result is unchanged. RuleTrade will not invent or rerun missing evidence.</p></div></section>;
  return <section className="analysis-workspace" aria-label="Decision analysis"><header className="analysis-heading"><span className="eyebrow">Analysis</span><h2>See how the strategy made its choices</h2></header><div className="research-layout"><aside className="decision-timeline" aria-label="Decision timeline"><h3>Events</h3>{sessions.map((session) => <button key={session.sessionId} className={selected?.sessionId === session.sessionId ? "timeline-event selected" : "timeline-event"} onClick={() => onSelect(session)} aria-pressed={selected?.sessionId === session.sessionId}><time>{day(session.sessionId)}</time><strong>{session.label}</strong></button>)}</aside><div className="research-inspector">{!selected && <div className="inspector-prompt"><h3>Select an event</h3><p>Use a marker on the chart or a date here.</p></div>}{selected && detailState === "loading" && <p role="status">Opening this decision…</p>}{selected && detailState === "error" && <div role="alert"><h3>We couldn't open this decision</h3></div>}{selected && detailState === "loaded" && <Inspector key={selected.sessionId} date={selected.sessionId} details={details} initialAsset={selectedAsset} onSelectAsset={onSelectAsset} onShowInStrategy={onShowInStrategy} />}</div></div></section>;
}

export function Inspector({ date = details[0]?.session_id ?? "1970-01-01", details, initialAsset, onSelectAsset, onShowInStrategy }: { date?: string; details: DecisionEventDetail[]; initialAsset?: string | null; onSelectAsset?: (asset: string) => void; onShowInStrategy?: ShowRule }) {
  const outcomes = assetOutcomes(details);
  const preferred = outcomes.find((item) => ["failed", "blocked", "ranked_out"].includes(item.kind))?.asset ?? outcomes[0]?.asset ?? null;
  const [asset, setAsset] = useState(initialAsset && outcomes.some((item) => item.asset === initialAsset) ? initialAsset : preferred);
  useEffect(() => { if (initialAsset && outcomes.some((item) => item.asset === initialAsset)) setAsset(initialAsset); }, [initialAsset, outcomes]);
  return <><DecisionSummary date={date} details={details} />{outcomes.length > 0 && <section className="inspector-section asset-hero"><span className="eyebrow">Asset outcomes</span><div className="asset-overview">{outcomes.map((item) => { const observed=observedValue(item.asset,details); return <button key={item.asset} className={`asset-outcome ${item.kind}`} onClick={() => { setAsset(item.asset); onSelectAsset?.(item.asset); }} aria-pressed={asset === item.asset}><StatusIcon status={statusForOutcome(item.kind)} /><span><strong>{item.asset}</strong><small>{observed}{observed ? " · " : ""}{item.label}</small></span></button>; })}</div>{asset && <AssetExplanation asset={asset} details={details} onShowInStrategy={onShowInStrategy} />}</section>}<SelectionPath details={details} selectedAsset={asset} onSelectAsset={(next) => { setAsset(next); onSelectAsset?.(next); }} onShowInStrategy={onShowInStrategy} /><Portfolio details={details} onShowInStrategy={onShowInStrategy} /><MoreDetails details={details} onShowInStrategy={onShowInStrategy} /></>;
}

function DecisionSummary({ date, details }: { date: string; details: DecisionEventDetail[] }) {
  const selection = details.find((item) => item.evidence.kind === "selection")?.evidence;
  const fallback = details.find((item) => item.evidence.kind === "fallback" && item.evidence.activated)?.evidence;
  const finalSelection = details.find((item) => item.evidence.kind === "final_selection")?.evidence;
  const finalTargets = details.find((item) => item.evidence.kind === "final_targets")?.evidence;
  let sentence = finalSelection?.kind === "final_selection" ? `The strategy selected ${finalSelection.selected.join(" + ")}.` : "The strategy recorded a decision.";
  if (selection?.kind === "selection" && selection.decision === "insufficient" && fallback?.kind === "fallback") sentence = "required_count" in selection ? `Only ${selection.candidates.length} of ${selection.required_count} assets qualified, so the strategy used ${fallback.asset} instead.` : `The normal selection was incomplete, so the strategy used ${fallback.asset} instead.`;
  const portfolio = finalTargets?.kind === "final_targets" ? Object.entries(finalTargets.targets).map(([asset, value]) => `${asset} ${pct(value)}`).join(" · ") : null;
  return <header className="decision-summary"><time>{day(date)}</time><h3>{sentence}</h3>{portfolio && <p><span>Final portfolio</span><strong>{portfolio}</strong></p>}</header>;
}

export function AssetExplanation({ asset, details, onShowInStrategy }: { asset: string; details: DecisionEventDetail[]; onShowInStrategy?: ShowRule }) {
  const steps = assetPath(asset, details);
  const stop = steps.find((item) => item.status === "failed") ?? steps.find((item) => item.status === "fallback");
  const proven = steps.some((item) => item.id !== "final" && item.status !== "neutral");
  return <article className="asset-explanation"><header><h4>{asset}</h4><p>{stop ? plainStop(asset, stop.label, stop.detail) : proven ? "See how this asset moved through the strategy." : "The available evidence does not prove why this asset stopped."}</p></header><ol className="condition-path">{steps.map((step) => <li key={step.id} className={step.status}><StatusIcon status={step.status} /><span><strong>{step.label}</strong><small>{step.detail}</small></span>{step.sourceComponentId && onShowInStrategy && <button className="text-button" onClick={() => onShowInStrategy(step.sourceComponentId!, step.sourceFieldPath, asset)}>View rule</button>}</li>)}</ol></article>;
}

function SelectionPath({ details, selectedAsset, onSelectAsset, onShowInStrategy }: { details: DecisionEventDetail[]; selectedAsset: string | null; onSelectAsset: (asset: string) => void; onShowInStrategy?: ShowRule }) {
  const outcomes = assetOutcomes(details).filter((item) => item.kind !== "fallback");
  const fallback = assetOutcomes(details).find((item) => item.kind === "fallback");
  if (!outcomes.length) return null;
  return <section className="inspector-section selection-path-v2"><span className="eyebrow">Selection path</span><h3>Where did each asset stop?</h3><div>{outcomes.map((outcome) => <button key={outcome.asset} className={selectedAsset === outcome.asset ? "path-row selected" : "path-row"} onClick={() => onSelectAsset(outcome.asset)}><strong>{outcome.asset}</strong><span className="path-steps">{assetPath(outcome.asset, details).filter((step) => step.id !== "final" || step.status !== "neutral").map((step) => <span key={step.id} className={`path-chip ${step.status}`} onClick={(event) => { if (step.sourceComponentId && onShowInStrategy) { event.stopPropagation(); onShowInStrategy(step.sourceComponentId, step.sourceFieldPath, outcome.asset); } }}><StatusIcon status={step.status} />{shortStep(step.label, step.detail)}</span>)}</span></button>)}</div>{fallback && <div className="fallback-destination"><StatusIcon status="fallback" /><span><strong>Not enough</strong><small>{fallback.asset} used instead</small></span></div>}</section>;
}

export function Portfolio({ details, onShowInStrategy }: { details: DecisionEventDetail[]; onShowInStrategy?: ShowRule }) {
  const sleeves = details.filter((item) => item.evidence.kind === "sleeve_contribution");
  const final = details.find((item) => item.evidence.kind === "final_targets")?.evidence;
  if (!sleeves.length && final?.kind !== "final_targets") return null;
  const contributions = new Map<string, Array<{ label: string; value: string }>>();
  for (const item of sleeves) if (item.evidence.kind === "sleeve_contribution") for (const [asset, value] of Object.entries(item.evidence.scaled_targets)) contributions.set(asset, [...(contributions.get(asset) ?? []), { label: sleeveName(item), value }]);
  return <section className="inspector-section portfolio-v2"><span className="eyebrow">Portfolio</span><h3>Where the money went</h3>{sleeves.map((item) => { if (item.evidence.kind !== "sleeve_contribution") return null; const ref=item.source_components.find((source)=>source.role==="sleeve"); return <div className="sleeve-group" key={item.id}><button className="portfolio-label" disabled={!ref || !onShowInStrategy} onClick={() => ref && onShowInStrategy?.(ref.component_id, ref.field_path, null)}>{sleeveName(item)} <b>{pct(item.evidence.allocation)}</b></button>{Object.entries(item.evidence.scaled_targets).map(([name,value])=><AllocationBar key={name} asset={name} value={value} />)}</div>; })}{final?.kind === "final_targets" && <div className="final-allocation"><h4>Final</h4>{Object.entries(final.targets).map(([name,value])=><AllocationBar key={name} asset={name} value={value} segments={contributions.get(name)} />)}</div>}</section>;
}
function AllocationBar({ asset, value, segments }: { asset: string; value: string; segments?: Array<{ label: string; value: string }> }) { const width=Math.max(0,Math.min(100,Number(value)*100)); return <div className="allocation-row"><strong>{asset}</strong><div className="allocation-track" aria-label={`${asset} ${pct(value)}`}><span style={{ width: `${width}%` }}>{segments?.map((segment,index)=><i key={`${segment.label}-${index}`} style={{ flexGrow: Number(segment.value) }} title={`${segment.label} ${pct(segment.value)}`} />)}</span></div><b>{pct(value)}</b>{segments && <small>{segments.map((segment)=>`${segment.label} ${pct(segment.value)}`).join(" + ")}</small>}</div>; }

function MoreDetails({ details, onShowInStrategy }: { details: DecisionEventDetail[]; onShowInStrategy?: ShowRule }) { const refs=dedupeRefs(details.flatMap((item)=>item.source_components)); const snapshots=details.find((item)=>item.evidence.kind==="snapshot_usage")?.evidence; return <details className="evidence-details"><summary>More details</summary>{snapshots?.kind==="snapshot_usage" && <div><h4>Latest sleeve choices used</h4>{Object.entries(snapshots.snapshots).map(([name,date])=><p key={name}>{name.replaceAll("_"," ")} · {day(date)}</p>)}</div>}<div><h4>Strategy sources</h4>{refs.map((ref)=><p key={`${ref.role}-${ref.component_id}-${ref.field_path ?? ""}`}>{ref.role.replaceAll("_"," ")}{onShowInStrategy && <button className="text-button" onClick={()=>onShowInStrategy(ref.component_id,ref.field_path,null)}>View rule</button>}</p>)}</div><div><h4>Recorded evidence</h4>{details.map((item)=><p key={item.id}>#{item.ordinal} · {item.kind.replaceAll("_"," ")} · {item.phase.replaceAll("_"," ")}</p>)}</div></details>; }

function observedValue(asset: string, details: DecisionEventDetail[]): string { const filter=details.find((item)=>item.evidence.kind==="filter")?.evidence; const evaluation=filter?.kind==="filter"?filter.evaluations.find((item)=>item.asset===asset):undefined; if(evaluation)return pct(evaluation.observed); const selection=details.find((item)=>item.evidence.kind==="selection")?.evidence; return selection?.kind==="selection" && selection.scores[asset]!==undefined ? pct(selection.scores[asset]) : ""; }
function plainStop(asset: string, label: string, detail: string): string { if(label==="Qualification rule") return `${asset} wasn't selected because it didn't qualify: ${detail}.`; if(label==="Ranking") return `${asset} qualified, but stopped at ${detail.toLowerCase()}.`; if(label==="Waiting period") return `${asset} was a candidate, but was still waiting: ${detail}.`; return `${asset}: ${detail}.`; }
function shortStep(label: string, detail: string): string { if(label==="Qualification rule")return "Qualification"; if(label==="Ranking" && detail.startsWith("Rank"))return detail.split(" · ")[0]; if(label==="Primary selection")return detail==="Selected"?"Chosen":detail; return label; }
function sleeveName(item: DecisionEventDetail): string { return item.source_components.find((source)=>source.role==="sleeve")?.component_id.replace(/_sleeve$/,"").replaceAll("_"," ").replace(/^./,(value)=>value.toUpperCase()) ?? "Allocation"; }
function StatusIcon({ status }: { status: PathStatus }) { return <span className="status-icon" aria-hidden="true">{status === "passed" ? "✓" : status === "failed" ? "✕" : status === "fallback" ? "◆" : "—"}</span>; }
function statusForOutcome(kind: ReturnType<typeof assetOutcomes>[number]["kind"]): PathStatus { return kind === "selected" ? "passed" : kind === "failed" || kind === "blocked" || kind === "ranked_out" ? "failed" : kind === "fallback" || kind === "replaced" ? "fallback" : "neutral"; }
function dedupeRefs(refs: SourceComponentRef[]): SourceComponentRef[] { const seen=new Set<string>(); return refs.filter((ref)=>{const key=`${ref.role}:${ref.component_id}:${ref.field_path ?? ""}`;if(seen.has(key))return false;seen.add(key);return true;}); }

/** Compatibility exports retained while Analysis presentation moves to v2. */
export const Sleeves = Portfolio;
export function Snapshots({ details }: { details: DecisionEventDetail[] }) {
  const snapshots=details.find((item)=>item.evidence.kind==="snapshot_usage")?.evidence;
  if(snapshots?.kind!=="snapshot_usage")return null;
  return <section><h3>Latest sleeve choices used</h3>{Object.entries(snapshots.snapshots).map(([name,date])=><p key={name}>{name.replaceAll("_"," ")} · {day(date)}</p>)}</section>;
}
