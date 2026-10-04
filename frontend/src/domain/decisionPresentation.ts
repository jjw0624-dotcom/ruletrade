import type { DecisionEventDetail, DecisionEventSummary } from "../decisionEvidenceApi";

export interface DecisionSession { sessionId: string; events: DecisionEventSummary[]; label: string }

export type AssetOutcomeKind = "selected" | "failed" | "ranked_out" | "blocked" | "fallback" | "replaced" | "candidate" | "unknown";
export interface AssetOutcome { asset: string; kind: AssetOutcomeKind; label: string }
export type PathStatus = "passed" | "failed" | "neutral" | "fallback";
export interface AssetPathStep { id: string; label: string; detail: string; status: PathStatus; sourceComponentId?: string; sourceFieldPath?: string | null }

export function groupDecisionSessions(items: DecisionEventSummary[]): DecisionSession[] {
  const groups = new Map<string, DecisionEventSummary[]>();
  for (const item of [...items].sort((a, b) => a.ordinal - b.ordinal)) groups.set(item.session_id, [...(groups.get(item.session_id) ?? []), item]);
  return [...groups].map(([sessionId, events]) => ({ sessionId, events, label: sessionLabel(events) }));
}

function sessionLabel(events: DecisionEventSummary[]): string {
  const kinds = new Set(events.map((event) => event.kind));
  // A summary proves fallback evaluation, not activation. The selected
  // Decision detail carries the authoritative activated value.
  if (kinds.has("fallback")) return "Fallback evaluated";
  if (kinds.has("cooldown")) return "Asset still waiting";
  if (kinds.has("predicate") || kinds.has("value_condition")) return "Value condition evaluated";
  if (kinds.has("final_targets") || kinds.has("sleeve_contribution") || kinds.has("snapshot_usage")) return "Portfolio updated";
  if (kinds.has("state_mutation")) return "Waiting period updated";
  if (kinds.has("filter") || kinds.has("selection")) return "Assets evaluated";
  if (kinds.has("random_selection")) return "Assets chosen";
  return "Strategy decision";
}

export function happenedText(details: DecisionEventDetail[]): string {
  const valueCondition = details.find((item) => item.evidence.kind === "value_condition")?.evidence;
  if (valueCondition?.kind === "value_condition") return valueCondition.outcome
    ? `${valueCondition.subject} passed the ${valueCondition.scope} value condition.`
    : `${valueCondition.subject} did not pass the ${valueCondition.scope} value condition.`;
  const predicate = details.find((item) => item.evidence.kind === "predicate")?.evidence;
  if (predicate?.kind === "predicate") return predicate.outcome
    ? `The market condition passed and the strategy took its THEN branch.`
    : `The market condition did not pass and the strategy retained its current portfolio.`;
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
    if (evidence.kind === "value_condition" && evidence.subject !== "strategy") assets.add(evidence.subject);
    if (evidence.kind === "predicate") assets.add(evidence.asset);
    if (evidence.kind === "filter") {
      evidence.evaluations.forEach((item) => assets.add(item.asset));
      if ("decision_universe" in evidence) evidence.decision_universe.forEach((asset) => assets.add(asset));
    }
    if (evidence.kind === "selection") Object.keys(evidence.scores).forEach((asset) => assets.add(asset));
    if (evidence.kind === "selection" && "asset_outcomes" in evidence) evidence.asset_outcomes.forEach((item) => assets.add(item.asset));
    if (evidence.kind === "cooldown" || evidence.kind === "state_mutation" || evidence.kind === "fallback") assets.add(evidence.asset);
    if (evidence.kind === "final_selection" || evidence.kind === "random_selection" || evidence.kind === "final_targets") evidence.selected.forEach((asset) => assets.add(asset));
  }
  return [...assets];
}

export function assetOutcomes(details: DecisionEventDetail[]): AssetOutcome[] {
  const filter = details.find((item) => item.evidence.kind === "filter")?.evidence;
  const selection = details.find((item) => item.evidence.kind === "selection")?.evidence;
  const final = details.find((item) => item.evidence.kind === "final_selection")?.evidence;
  const targets = details.find((item) => item.evidence.kind === "final_targets")?.evidence;
  const fallback = details.find((item) => item.evidence.kind === "fallback")?.evidence;
  return relevantAssets(details).map((asset) => {
    const evaluation = filter?.kind === "filter" ? filter.evaluations.find((item) => item.asset === asset) : undefined;
    const selectionOutcome = selection?.kind === "selection" && "asset_outcomes" in selection ? selection.asset_outcomes.find((item) => item.asset === asset) : undefined;
    const cooldown = details.find((item) => item.evidence.kind === "cooldown" && item.evidence.asset === asset)?.evidence;
    if (fallback?.kind === "fallback" && fallback.activated && fallback.asset === asset) return { asset, kind: "fallback", label: "Fallback selected" };
    if (cooldown?.kind === "cooldown" && cooldown.signal_candidate && !cooldown.eligible) return { asset, kind: "blocked", label: "Blocked by waiting period" };
    if (evaluation && !evaluation.passed && filter?.kind === "filter") return { asset, kind: "failed", label: `Needed > ${formatScore(filter.threshold)}` };
    if (selectionOutcome?.stopping_stage === "fallback_replacement") return { asset, kind: "replaced", label: "Candidate · replaced by fallback" };
    if (selectionOutcome?.stopping_stage === "primary_selection_incomplete") return { asset, kind: "replaced", label: "Candidate · primary selection incomplete" };
    if (selectionOutcome?.signal === "absent") return { asset, kind: "ranked_out", label: `Signal absent · ranked #${selectionOutcome.rank} below cutoff` };
    if (final?.kind === "final_selection" && final.selected.includes(asset)) return { asset, kind: "selected", label: "Selected" };
    if (targets?.kind === "final_targets" && targets.selected.includes(asset)) return { asset, kind: "selected", label: "Final portfolio target" };
    if (selection?.kind === "selection" && selection.primary_selected.includes(asset)) return { asset, kind: "selected", label: "Selected" };
    if (selectionOutcome?.signal === "present") return { asset, kind: "candidate", label: "Candidate · final outcome not recorded here" };
    if (selection?.kind === "selection" && !("asset_outcomes" in selection) && selection.ranked.includes(asset)) return { asset, kind: "ranked_out", label: `Ranked #${selection.ranked.indexOf(asset) + 1} · not selected` };
    if (selection?.kind === "selection" && !("asset_outcomes" in selection) && selection.candidates.includes(asset)) return { asset, kind: "candidate", label: "Candidate · final outcome not recorded here" };
    return { asset, kind: "unknown", label: "Outcome not proven by this evidence" };
  });
}

function sourceFor(details: DecisionEventDetail[], kind: DecisionEventDetail["kind"], role?: string) {
  const event = details.find((item) => item.kind === kind);
  return event?.source_components.find((item) => !role || item.role === role);
}

export function assetPath(asset: string, details: DecisionEventDetail[]): AssetPathStep[] {
  const steps: AssetPathStep[] = [];
  const valueConditionEvent = details.find((item) => item.evidence.kind === "value_condition" && item.evidence.subject === asset);
  const valueCondition = valueConditionEvent?.evidence;
  if (valueCondition?.kind === "value_condition") {
    const source = valueConditionEvent.source_components[0];
    steps.push({
      id: `value-${valueCondition.scope}`,
      label: valueCondition.scope === "predicate" ? "Value condition" : "Eligibility",
      detail: `${formatValue(valueCondition.left_observed, valueCondition.left_type)} ${valueCondition.operator} ${formatValue(valueCondition.right_observed, valueCondition.right_type)}`,
      status: valueCondition.outcome ? "passed" : "failed",
      sourceComponentId: source?.component_id,
      sourceFieldPath: source?.field_path,
    });
  }
  const predicate = details.find((item) => item.evidence.kind === "predicate" && item.evidence.asset === asset)?.evidence;
  const predicateSource = sourceFor(details, "predicate", "predicate");
  if (predicate?.kind === "predicate") steps.push({
    id: "predicate", label: "Market condition",
    detail: `${predicate.observed === null ? "Not enough completed history" : formatScore(predicate.observed)} ${predicate.operator} ${formatScore(predicate.threshold)} · ${predicate.branch.toUpperCase()} branch`,
    status: predicate.outcome ? "passed" : "failed",
    sourceComponentId: predicateSource?.component_id,
    sourceFieldPath: predicateSource?.field_path,
  });
  const filter = details.find((item) => item.evidence.kind === "filter")?.evidence;
  const evaluation = filter?.kind === "filter" ? filter.evaluations.find((item) => item.asset === asset) : undefined;
  const selection = details.find((item) => item.evidence.kind === "selection")?.evidence;
  const selectionOutcome = selection?.kind === "selection" && "asset_outcomes" in selection ? selection.asset_outcomes.find((item) => item.asset === asset) : undefined;
  const cooldown = details.find((item) => item.evidence.kind === "cooldown" && item.evidence.asset === asset)?.evidence;
  const fallback = details.find((item) => item.evidence.kind === "fallback")?.evidence;
  const final = details.find((item) => item.evidence.kind === "final_selection")?.evidence;
  const filterSource = sourceFor(details, "filter", "filter");
  if (evaluation && filter?.kind === "filter") steps.push({ id: "filter", label: "Qualification rule", detail: `${formatScore(evaluation.observed)} > ${formatScore(filter.threshold)}`, status: evaluation.passed ? "passed" : "failed", sourceComponentId: filterSource?.component_id, sourceFieldPath: filterSource?.field_path });
  if (selection?.kind === "selection") {
    if (evaluation && !evaluation.passed) steps.push({ id: "ranking", label: "Ranking", detail: "Not reached", status: "neutral" });
    else if (selectionOutcome?.stopping_stage === "rank_cutoff") { const source = sourceFor(details, "selection", "selection"); steps.push({ id: "ranking", label: "Ranking", detail: `Rank #${selectionOutcome.rank} · below cutoff`, status: "failed", sourceComponentId: source?.component_id, sourceFieldPath: source?.field_path }); }
    else if (selection.ranked.includes(asset)) steps.push({ id: "ranking", label: "Ranking", detail: `Rank #${selectionOutcome?.rank ?? selection.ranked.indexOf(asset) + 1}`, status: "passed", sourceComponentId: sourceFor(details, "selection", "rank")?.component_id, sourceFieldPath: sourceFor(details, "selection", "rank")?.field_path });
    else steps.push({ id: "ranking", label: "Ranking", detail: "Not recorded for this asset", status: "neutral" });
    if (evaluation && !evaluation.passed) steps.push({ id: "primary", label: "Primary selection", detail: "Not reached", status: "neutral" });
    else if (selectionOutcome?.stopping_stage !== "rank_cutoff") { const source = sourceFor(details, "selection", "selection"); steps.push({ id: "primary", label: "Primary selection", detail: selection.primary_selected.includes(asset) ? "Selected" : selectionOutcome?.stopping_stage === "fallback_replacement" ? "Replaced by fallback" : selectionOutcome?.stopping_stage === "primary_selection_incomplete" ? "Incomplete selection" : "Not in the selected set", status: selection.primary_selected.includes(asset) ? "passed" : selectionOutcome?.stopping_stage === "fallback_replacement" ? "fallback" : "failed", sourceComponentId: source?.component_id, sourceFieldPath: source?.field_path }); }
  }
  if (cooldown?.kind === "cooldown") { const source = sourceFor(details, "cooldown", "cooldown"); steps.push({ id: "cooldown", label: "Waiting period", detail: cooldown.signal_candidate ? (cooldown.eligible ? "Eligible" : `${cooldown.elapsed_completed_sessions ?? 0} of ${cooldown.required_completed_sessions} sessions · blocked`) : "Evidence explicitly records no candidate signal", status: cooldown.eligible ? "passed" : "failed", sourceComponentId: source?.component_id, sourceFieldPath: source?.field_path }); }
  if (fallback?.kind === "fallback" && fallback.asset === asset && fallback.activated) steps.push({ id: "fallback", label: "Fallback", detail: "Activated and selected", status: "fallback", sourceComponentId: sourceFor(details, "fallback", "fallback")?.component_id, sourceFieldPath: sourceFor(details, "fallback", "fallback")?.field_path });
  const selected = (final?.kind === "final_selection" && final.selected.includes(asset)) || (selection?.kind === "selection" && selection.primary_selected.includes(asset));
  steps.push({ id: "final", label: "Final outcome", detail: selected ? "Selected" : "Not selected", status: selected ? (fallback?.kind === "fallback" && fallback.asset === asset ? "fallback" : "passed") : "neutral" });
  return steps;
}

function formatScore(value: string): string { return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(Number(value)); }

function formatValue(value: string | null, valueType: string): string {
  if (value === null) return "Not enough completed data";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (valueType === "percentage") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(numeric);
  if (valueType === "money_per_share") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(numeric);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(numeric);
}
