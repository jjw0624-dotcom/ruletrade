import type { DecisionEventDetail, DecisionEventSummary } from "../decisionEvidenceApi";

export interface DecisionSession { sessionId: string; events: DecisionEventSummary[]; label: string }

export function groupDecisionSessions(items: DecisionEventSummary[]): DecisionSession[] {
  const groups = new Map<string, DecisionEventSummary[]>();
  for (const item of [...items].sort((a, b) => a.ordinal - b.ordinal)) groups.set(item.session_id, [...(groups.get(item.session_id) ?? []), item]);
  return [...groups].map(([sessionId, events]) => ({ sessionId, events, label: sessionLabel(events) }));
}

function sessionLabel(events: DecisionEventSummary[]): string {
  const kinds = new Set(events.map((event) => event.kind));
  if (kinds.has("fallback")) return "Fallback decision";
  if (kinds.has("cooldown")) return "Eligibility decision";
  if (kinds.has("final_targets") || kinds.has("sleeve_contribution") || kinds.has("snapshot_usage")) return "Portfolio rebalance";
  if (kinds.has("state_mutation")) return "Waiting period updated";
  if (kinds.has("filter") || kinds.has("selection")) return "Asset selection";
  if (kinds.has("random_selection")) return "Assets selected";
  return "Strategy decision";
}

export function happenedText(details: DecisionEventDetail[]): string {
  const final = details.find((item) => item.evidence.kind === "final_selection")?.evidence;
  if (final?.kind === "final_selection") return final.source === "fallback" ? `The strategy used its fallback: ${final.selected.join(", ")}.` : `The strategy selected ${final.selected.join(", ")}.`;
  const targets = details.find((item) => item.evidence.kind === "final_targets")?.evidence;
  if (targets?.kind === "final_targets") return `The portfolio set final targets for ${targets.selected.join(", ")}.`;
  const blocked = details.find((item) => item.evidence.kind === "cooldown" && !item.evidence.eligible)?.evidence;
  if (blocked?.kind === "cooldown") return `${blocked.asset} was a candidate but was not yet eligible.`;
  const refresh = details.find((item) => item.evidence.kind === "snapshot_refresh")?.evidence;
  if (refresh?.kind === "snapshot_refresh") return `A ${refresh.schedule} sleeve snapshot was refreshed.`;
  return "The strategy recorded this decision step.";
}

export function relevantAssets(details: DecisionEventDetail[]): string[] {
  const assets = new Set<string>();
  for (const { evidence } of details) {
    if (evidence.kind === "filter") evidence.evaluations.forEach((item) => assets.add(item.asset));
    if (evidence.kind === "selection") Object.keys(evidence.scores).forEach((asset) => assets.add(asset));
    if (evidence.kind === "cooldown" || evidence.kind === "state_mutation" || evidence.kind === "fallback") assets.add(evidence.asset);
    if (evidence.kind === "final_selection" || evidence.kind === "random_selection" || evidence.kind === "final_targets") evidence.selected.forEach((asset) => assets.add(asset));
  }
  return [...assets];
}
