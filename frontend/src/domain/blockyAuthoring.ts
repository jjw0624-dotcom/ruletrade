import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../structuralAuthoringApi";
import type { LogicStep } from "./logicRepresentation";

export function qualificationDropOperation(rankId: string | undefined, capabilities: StructuralAuthoringCapabilities | null): Extract<StructuralAuthoringOperation, { kind: "add_qualification_condition" }> | null {
  return rankId && capabilities?.qualification_add_targets.includes(rankId)
    ? { kind: "add_qualification_condition", rank_component_id: rankId } : null;
}

export function blockFieldOperation(step: LogicStep, next: number, capabilities: StructuralAuthoringCapabilities | null): StructuralAuthoringOperation | null {
  const id = step.selection.componentId;
  if (!id || !Number.isFinite(next) || !capabilities) return null;
  if (step.kind === "condition" && capabilities.qualification_threshold_targets.some((item) => item.component_id === id)) return { kind: "update_qualification_threshold", component_id: id, threshold: String(next / 100) };
  if (step.kind === "score" && Number.isInteger(next) && capabilities.lookback_targets.some((item) => item.component_id === id)) return { kind: "update_lookback", component_id: id, lookback_bars: next };
  if (step.kind === "choose" && Number.isInteger(next) && capabilities.selection_count_targets.some((item) => item.component_id === id)) return { kind: "update_selection_count", component_id: id, count: next };
  if (step.kind === "cooldown" && Number.isInteger(next) && capabilities.cooldown_duration_targets.some((item) => item.component_id === id)) return { kind: "update_cooldown_duration", component_id: id, duration: next };
  return null;
}
