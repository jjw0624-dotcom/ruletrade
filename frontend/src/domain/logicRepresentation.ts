import { projectConceptualFlow } from "./conceptualFlow";
import type { CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { semanticSelection, type SemanticSelection } from "./semanticSelection";

// Decision order is deliberately separate from Flow's capital/ownership layout.
export interface LogicStep {
  kind: "group" | "assets" | "score" | "condition" | "rank" | "choose" | "cooldown" | "fallback" | "schedule";
  text: string;
  selection: SemanticSelection;
  value?: number;
  unit?: "percent" | "integer";
}
export interface LogicGroup { id: string; steps: LogicStep[] }
export interface LogicRepresentation { groups: LogicGroup[]; unsupportedReason?: string }

export function projectLogicRepresentation(strategy: CanonicalStrategyV1, registry: RegistryPayload): LogicRepresentation {
  const flow = projectConceptualFlow(strategy, registry);
  if (flow.unsupportedReason) return { groups: [], unsupportedReason: flow.unsupportedReason };
  const groups = flow.groups.map((group) => {
    const groupId = group.id;
    const steps: LogicStep[] = [{ kind: "group", text: `${group.label}${group.allocation ? ` · ${group.allocation}` : ""}`,
      selection: semanticSelection("group", group.sleeveComponentId ?? group.universeComponentId ?? null, { groupId }) }];
    if (!group.universeComponentId) return { id: groupId, steps: [] };
    steps.push({ kind: "assets", text: `Assets · ${group.assets.join(", ")}`, selection: semanticSelection("universe", group.universeComponentId, { groupId }) });
    const choose = group.choose;
    if (choose) {
      if (choose.selectionMode === "ranked") {
        if (!choose.lookbackComponentId || !choose.rankComponentId || !choose.lookbackBars || choose.topN === undefined) return { id: groupId, steps: [] };
        steps.push({ kind: "score", text: `Trailing return · ${choose.lookbackBars} observations`, value: choose.lookbackBars, unit: "integer", selection: semanticSelection("rule", choose.lookbackComponentId, { fieldPath: "config.lookback_bars", groupId }) });
        if (choose.filterComponentId) steps.push({ kind: "condition", text: "Return above", value: Number(choose.threshold ?? "0") * 100, unit: "percent", selection: semanticSelection("qualification", choose.filterComponentId, { fieldPath: "config.threshold", groupId }) });
        steps.push({ kind: "rank", text: choose.ranking ?? "Rank assets", selection: semanticSelection("rule", choose.rankComponentId, { groupId }) });
      }
      steps.push({ kind: "choose", text: choose.selectionMode === "random" ? `Choose ${choose.topN} randomly` : `Take strongest ${choose.topN}`,
        value: choose.topN, unit: "integer", selection: semanticSelection("selection", choose.selectionComponentId, { fieldPath: "config.count", groupId }) });
      if (choose.cooldownComponentId) steps.push({ kind: "cooldown", text: "Wait after selling", value: choose.cooldownDuration, unit: "integer", selection: semanticSelection("cooldown", choose.cooldownComponentId, { fieldPath: "config.duration", groupId }) });
      if (choose.fallbackComponentId) steps.push({ kind: "fallback", text: choose.otherwise ?? "Fallback when incomplete", selection: semanticSelection("fallback", choose.fallbackComponentId, { groupId }) });
    }
    if (group.scheduleComponentId) steps.push({ kind: "schedule", text: group.timing ?? "Schedule", selection: semanticSelection("schedule", group.scheduleComponentId, { groupId }) });
    return { id: groupId, steps };
  });
  if (groups.some((group) => !group.steps.length)) return { groups: [], unsupportedReason: "The decision order is ambiguous for this Strategy shape." };
  if (flow.rebalanceScheduleComponentId) groups.push({ id: "portfolio-schedule", steps: [{ kind: "schedule", text: flow.rebalance ?? "Portfolio rebalance", selection: semanticSelection("schedule", flow.rebalanceScheduleComponentId) }] });
  return { groups };
}

export function logicStepForSelection(projection: LogicRepresentation, selection: SemanticSelection | null): LogicStep | null {
  if (!selection?.componentId) return null;
  return projection.groups.flatMap((group) => group.steps).find((step) => step.selection.componentId === selection.componentId
    && (!selection.fieldPath || step.selection.fieldPath === selection.fieldPath)) ?? null;
}
