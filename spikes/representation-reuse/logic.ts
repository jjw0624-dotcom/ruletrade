import { projectConceptualFlow } from "../../frontend/src/domain/conceptualFlow";
import type { CanonicalStrategyV1, RegistryPayload } from "../../frontend/src/domain/canonical";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../../frontend/src/structuralAuthoringApi";

// A deliberately narrow logic perspective. This is disposable editor input, not Strategy storage.
export interface LogicStep {
  role: "assets" | "score" | "condition" | "rank" | "choose" | "fallback";
  componentId: string;
  fieldPath?: string;
  label: string;
  value?: string;
}

export function projectLogic(strategy: CanonicalStrategyV1, registry: RegistryPayload): LogicStep[] {
  const flow = projectConceptualFlow(strategy, registry);
  const group = flow.groups[0], choose = group?.choose;
  if (flow.unsupportedReason || flow.groups.length !== 1 || !choose || choose.selectionMode !== "ranked") {
    throw new Error("Spike supports one ranked investment pipeline only");
  }
  if (!group.universeComponentId || !choose.lookbackComponentId || !choose.rankComponentId) {
    throw new Error("Ranked pipeline has no unambiguous provenance");
  }
  const steps: LogicStep[] = [
    { role: "assets", componentId: group.universeComponentId, label: group.assets.join(", ") },
    { role: "score", componentId: choose.lookbackComponentId, fieldPath: "config.lookback_bars", label: `${choose.lookbackBars} completed bars` },
  ];
  if (choose.filterComponentId) steps.push({
    role: "condition", componentId: choose.filterComponentId, fieldPath: "config.threshold",
    label: "Return above", value: choose.threshold ?? "0",
  });
  steps.push(
    { role: "rank", componentId: choose.rankComponentId, label: choose.rankDirection ?? "descending" },
    { role: "choose", componentId: choose.selectionComponentId, fieldPath: "config.count", label: String(choose.topN) },
  );
  if (choose.fallbackComponentId) steps.push({ role: "fallback", componentId: choose.fallbackComponentId, label: choose.otherwise ?? "Fallback" });
  return steps;
}

export function addConditionIntent(steps: LogicStep[], capabilities: StructuralAuthoringCapabilities): StructuralAuthoringOperation | null {
  const target = steps.find((step) => step.role === "rank")?.componentId;
  return target && capabilities.qualification_add_targets.includes(target)
    ? { kind: "add_qualification_condition", rank_component_id: target } : null;
}

export function removeConditionIntent(step: LogicStep, capabilities: StructuralAuthoringCapabilities): StructuralAuthoringOperation | null {
  return step.role === "condition" && capabilities.qualification_remove_targets.includes(step.componentId)
    ? { kind: "remove_qualification_condition", condition_component_id: step.componentId } : null;
}

export function thresholdIntent(step: LogicStep, value: number, capabilities: StructuralAuthoringCapabilities): StructuralAuthoringOperation | null {
  return step.role === "condition" && step.fieldPath === "config.threshold" &&
    Number.isFinite(value) && capabilities.qualification_threshold_targets.some((target) => target.component_id === step.componentId)
    ? { kind: "update_qualification_threshold", component_id: step.componentId, threshold: String(value / 100) } : null;
}
