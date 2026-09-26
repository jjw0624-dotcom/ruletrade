import type { ConceptualFlowProjection, ConceptualGroup } from "./conceptualFlow";
import { semanticSelection, type SemanticSelection } from "./semanticSelection";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../structuralAuthoringApi";

export type BuilderBlockKind = "choose" | "qualification" | "fallback" | "cooldown" | "split";

export interface StructureItem {
  id: string;
  label: string;
  detail?: string;
  selection: SemanticSelection;
  children: StructureItem[];
}

export interface ConstructionOption {
  kind: BuilderBlockKind;
  label: string;
  description: string;
  targetComponentId: string;
  targetLabel: string;
  groupId: string | null;
  anchorSelection: SemanticSelection;
}

function groupItems(group: ConceptualGroup): StructureItem[] {
  const universe: StructureItem = {
    id: `${group.id}:universe`,
    label: "Assets",
    detail: group.assets.join(", "),
    selection: semanticSelection("universe", group.universeComponentId ?? null, { groupId: group.id }),
    children: [],
  };
  if (!group.choose) return [universe];
  const choose = group.choose;
  const pipeline: StructureItem[] = [];
  if (choose.filterComponentId) {
    pipeline.push({
      id: `${group.id}:qualification`,
      label: "Qualification",
      detail: choose.condition,
      selection: semanticSelection("qualification", choose.filterComponentId, {
        fieldPath: "config.threshold",
        groupId: group.id,
      }),
      children: [],
    });
  }
  pipeline.push({
    id: `${group.id}:selection`,
    label: choose.label,
    detail: choose.ranking,
    selection: semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }),
    children: [],
  });
  if (choose.cooldownComponentId) {
    pipeline.push({
      id: `${group.id}:cooldown`, label: "Cooldown", detail: choose.cooldown,
      selection: semanticSelection("cooldown", choose.cooldownComponentId, {
        fieldPath: "config.duration", groupId: group.id,
      }), children: [],
    });
  }
  if (choose.fallbackComponentId) {
    pipeline.push({
      id: `${group.id}:fallback`,
      label: "Fallback",
      detail: choose.otherwise,
      selection: semanticSelection("fallback", choose.fallbackComponentId, { groupId: group.id }),
      children: [],
    });
  }
  universe.children = pipeline;
  return [universe];
}

export function projectBuilderStructure(projection: ConceptualFlowProjection): StructureItem {
  if (projection.unsupportedReason) return {
    id: "portfolio",
    label: "Strategy",
    detail: "Unsupported Builder shape",
    selection: semanticSelection("portfolio", null),
    children: [{
      id: "unsupported",
      label: "Cannot project this structure",
      detail: projection.unsupportedReason,
      selection: semanticSelection("portfolio", null),
      children: [],
    }],
  };
  const groups = projection.groups.map((group) => ({
    id: `group:${group.id}`,
    label: group.label,
    detail: group.allocation,
    selection: semanticSelection("group", group.sleeveComponentId ?? group.universeComponentId ?? null, {
      groupId: group.id,
    }),
    children: groupItems(group),
  }));
  const children = projection.split
    ? [{
        id: "split",
        label: "Split",
        detail: projection.groups.map((group) => group.allocation).join(" / "),
        selection: semanticSelection("split", projection.portfolioComponentId ?? null),
        children: groups,
      }]
    : groups;
  if (projection.rebalanceScheduleComponentId) {
    children.push({
      id: "schedule",
      label: "Rebalance",
      detail: projection.rebalance,
      selection: semanticSelection("schedule", projection.rebalanceScheduleComponentId),
      children: [],
    });
  }
  return {
    id: "portfolio",
    label: "Portfolio",
    selection: semanticSelection("portfolio", projection.portfolioComponentId ?? null),
    children,
  };
}

export function constructionOptions(
  projection: ConceptualFlowProjection,
  capabilities: StructuralAuthoringCapabilities | null,
  selection: SemanticSelection | null,
): ConstructionOption[] {
  if (!capabilities) return [];
  const options: ConstructionOption[] = [];
  for (const group of projection.groups) {
    const groupId = group.id;
    const targetLabel = group.label || "Investment";
    const chooseTarget = group.allocationComponentId;
    if (chooseTarget && capabilities.choose_pipeline_targets.includes(chooseTarget)) options.push({
      kind: "choose", label: "Choose assets", targetLabel, groupId,
      description: "Measure returns, rank this universe, and choose the strongest assets.",
      targetComponentId: chooseTarget,
      anchorSelection: semanticSelection("universe", group.universeComponentId ?? chooseTarget, { groupId }),
    });
    const rankTarget = group.choose?.rankComponentId;
    if (rankTarget && capabilities.qualification_add_targets.includes(rankTarget)) options.push({
      kind: "qualification", label: "Condition", targetLabel, groupId,
      description: "Require the supported positive-return condition before ranking.",
      targetComponentId: rankTarget,
      anchorSelection: semanticSelection("selection", group.choose!.selectionComponentId, { groupId }),
    });
    const fallbackTarget = group.allocationComponentId;
    if (fallbackTarget && capabilities.fallback_add_targets.includes(fallbackTarget)) options.push({
      kind: "fallback", label: "Fallback", targetLabel, groupId,
      description: "Choose where money goes when too few assets qualify.",
      targetComponentId: fallbackTarget,
      anchorSelection: semanticSelection("selection", group.choose?.selectionComponentId ?? fallbackTarget, { groupId }),
    });
    const cooldownTarget = group.choose?.selectionComponentId;
    if (cooldownTarget && capabilities.cooldown_add_targets.includes(cooldownTarget)) options.push({
      kind: "cooldown", label: "Cooldown", targetLabel, groupId,
      description: "After selling, wait before buying the same asset again.",
      targetComponentId: cooldownTarget,
      anchorSelection: semanticSelection("selection", cooldownTarget, { groupId }),
    });
  }
  const splitTarget = capabilities.growth_defensive_targets[0];
  if (splitTarget) {
    options.push({
      kind: "split",
      label: "Growth + Defensive",
      targetLabel: "Portfolio",
      groupId: null,
      description: "Keep the current strategy as Growth and add a Defensive group.",
      targetComponentId: splitTarget,
      anchorSelection: semanticSelection("portfolio", projection.portfolioComponentId ?? splitTarget),
    });
  }
  return options.sort((left, right) => Number(right.groupId === selection?.groupId) - Number(left.groupId === selection?.groupId));
}

export function semanticDeleteOperation(
  selection: SemanticSelection | null,
  capabilities: StructuralAuthoringCapabilities | null,
): StructuralAuthoringOperation | null {
  if (!selection?.componentId || !capabilities) return null;
  if (selection.role === "qualification"
    && capabilities.qualification_remove_targets.includes(selection.componentId)) {
    return { kind: "remove_qualification_condition", condition_component_id: selection.componentId };
  }
  if (selection.role === "fallback"
    && capabilities.fallback_remove_targets.includes(selection.componentId)) {
    return { kind: "remove_fallback_selection", fallback_component_id: selection.componentId };
  }
  if (selection.role === "cooldown"
    && capabilities.cooldown_remove_targets.includes(selection.componentId)) {
    return { kind: "remove_cooldown_from_selection", cooldown_component_id: selection.componentId };
  }
  return null;
}
