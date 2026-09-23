import type { CanonicalStrategyV1 } from "./canonical";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../structuralAuthoringApi";
import type { SemanticSelection } from "./semanticSelection";
import { projectConceptualFlow } from "./conceptualFlow";
import type { RegistryPayload } from "./canonical";

export interface ChangeProposalV0 { format: "ruletrade.change-proposal/v0"; operations: [StructuralAuthoringOperation] }
const allowed = new Set(["update_asset_set", "update_lookback", "update_qualification_threshold", "update_selection_count", "update_cooldown_duration", "update_schedule", "update_fallback_asset_set", "add_qualification_condition", "remove_qualification_condition", "add_cooldown_to_selection", "remove_cooldown_from_selection"]);

export function parseChangeProposal(input: string, capabilities: StructuralAuthoringCapabilities): ChangeProposalV0 {
  const source = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Paste a JSON proposal object.");
  const proposal = value as Record<string, unknown>;
  if (proposal.format !== "ruletrade.change-proposal/v0" || !Array.isArray(proposal.operations) || proposal.operations.length !== 1) throw new Error("Proposal v0 requires exactly one supported operation.");
  const operation = proposal.operations[0] as Record<string, unknown>;
  if (!operation || typeof operation !== "object" || !allowed.has(String(operation.kind))) throw new Error("This change is outside the supported proposal grammar.");
  const target = (key: string, ids: string[]) => typeof operation[key] === "string" && ids.includes(operation[key]);
  const eligible = (() => {
    switch (operation.kind) {
      case "update_asset_set": return target("asset_set_id", capabilities.asset_set_targets.map((item) => item.asset_set_id)) && Array.isArray(operation.assets);
      case "update_lookback": return target("component_id", capabilities.lookback_targets.map((item) => item.component_id)) && Number.isInteger(operation.lookback_bars);
      case "update_qualification_threshold": return target("component_id", capabilities.qualification_threshold_targets.map((item) => item.component_id)) && typeof operation.threshold === "string";
      case "update_selection_count": return target("component_id", capabilities.selection_count_targets.map((item) => item.component_id)) && Number.isInteger(operation.count);
      case "update_cooldown_duration": return target("component_id", capabilities.cooldown_duration_targets.map((item) => item.component_id)) && Number.isInteger(operation.duration);
      case "update_schedule": return target("component_id", capabilities.schedule_targets.map((item) => item.component_id)) && ["daily", "monthly", "quarterly"].includes(String(operation.cadence));
      case "update_fallback_asset_set": return target("component_id", capabilities.fallback_asset_set_targets.map((item) => item.component_id)) && typeof operation.asset_set_id === "string";
      case "add_qualification_condition": return target("rank_component_id", capabilities.qualification_add_targets);
      case "remove_qualification_condition": return target("condition_component_id", capabilities.qualification_remove_targets);
      case "add_cooldown_to_selection": return target("selection_component_id", capabilities.cooldown_add_targets) && Number.isInteger(operation.duration);
      case "remove_cooldown_from_selection": return target("cooldown_component_id", capabilities.cooldown_remove_targets);
      default: return false;
    }
  })();
  if (!eligible) throw new Error("The proposed target or value is unavailable in current backend capabilities.");
  return { format: "ruletrade.change-proposal/v0", operations: [operation as StructuralAuthoringOperation] };
}

export function describeChange(before: CanonicalStrategyV1, after: CanonicalStrategyV1, operation: StructuralAuthoringOperation): string[] {
  const old = new Map(before.graph.components.map((item) => [item.id, item]));
  const fresh = new Map(after.graph.components.map((item) => [item.id, item]));
  const changes = [...fresh.values()].filter((item) => JSON.stringify(old.get(item.id)) !== JSON.stringify(item)).map((item) => `${item.id}: ${old.has(item.id) ? JSON.stringify(old.get(item.id)?.config) : "added"} → ${JSON.stringify(item.config)}`);
  for (const item of old.values()) if (!fresh.has(item.id)) changes.push(`${item.id}: removed`);
  if (JSON.stringify(before.definitions.asset_sets) !== JSON.stringify(after.definitions.asset_sets)) changes.push(`Assets: ${JSON.stringify(before.definitions.asset_sets)} → ${JSON.stringify(after.definitions.asset_sets)}`);
  return changes.length ? changes : [`${operation.kind}: the validated structure changes`];
}

export function aiContext(strategy: CanonicalStrategyV1, registry: RegistryPayload, capabilities: StructuralAuthoringCapabilities | null, selection: SemanticSelection | null, revisionId: string | null, decision?: unknown) {
  const projection = projectConceptualFlow(strategy, registry);
  const selected = strategy.graph.components.find((item) => item.id === selection?.componentId) ?? null;
  return { format: "ruletrade.ai-context/v0", revision_id: revisionId, working_copy: true,
    explanation: projection.unsupportedReason ? projection.unsupportedReason : projection.groups.map((group) => `${group.label}: ${group.assets.join(", ")}; ${group.choose?.label ?? "hold assets"}; ${group.timing ?? "scheduled"}`).join("\n"),
    canonical: strategy, selected: selection ? { ...selection, component: selected, value: selection.fieldPath?.startsWith("config.") ? selected?.config[selection.fieldPath.slice(7)] : null } : null,
    authoring_capabilities: capabilities, decision_time_evidence: decision ?? null,
    instructions: "Suggest exactly one operation using the available target IDs. Return JSON: {\"format\":\"ruletrade.change-proposal/v0\",\"operations\":[{\"kind\":\"update_qualification_threshold\",\"component_id\":\"EXACT_ID\",\"threshold\":\"0.05\"}]}. Do not return Canonical, executable C#, or unsupported graph edits. The user will preview and apply the change in RuleTrade.",
  };
}
