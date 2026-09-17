import type { ConceptualFlowProjection, ConceptualGroup } from "./conceptualFlow";
import { semanticSelection, type SemanticSelection } from "./semanticSelection";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../structuralAuthoringApi";

export type BuilderBlockKind = "choose" | "qualification" | "fallback" | "split";

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

function selectedGroup(
  projection: ConceptualFlowProjection,
  selection: SemanticSelection | null,
): ConceptualGroup | undefined {
  return projection.groups.find((group) => group.id === selection?.groupId);
}

export function constructionOptions(
  projection: ConceptualFlowProjection,
  capabilities: StructuralAuthoringCapabilities | null,
  selection: SemanticSelection | null,
): ConstructionOption[] {
  if (!capabilities) return [];
  const options: ConstructionOption[] = [];
  const group = selectedGroup(projection, selection) ?? projection.groups[0];
  const rootContext = !selection || selection.role === "portfolio" || selection.role === "group";
  const universeContext = selection?.role === "universe";
  const selectionContext = selection?.role === "selection";
  const chooseTarget = group?.allocationComponentId;
  if ((rootContext || universeContext) && chooseTarget && capabilities.choose_pipeline_targets.includes(chooseTarget)) {
    options.push({
      kind: "choose",
      label: "Choose assets",
      description: "Measure returns, rank this universe, and choose the strongest assets.",
      targetComponentId: chooseTarget,
    });
  }
  const rankTarget = group?.choose?.rankComponentId;
  if (selectionContext && rankTarget && capabilities.qualification_add_targets.includes(rankTarget)) {
    options.push({
      kind: "qualification",
      label: "Qualification",
      description: "Require the supported positive-return condition before ranking.",
      targetComponentId: rankTarget,
    });
  }
  const fallbackTarget = group?.allocationComponentId;
  if (selectionContext && fallbackTarget && capabilities.fallback_add_targets.includes(fallbackTarget)) {
    options.push({
      kind: "fallback",
      label: "Fallback",
      description: "Choose where money goes when too few assets qualify.",
      targetComponentId: fallbackTarget,
    });
  }
  const splitTarget = capabilities.growth_defensive_targets[0];
  if (rootContext && splitTarget) {
    options.push({
      kind: "split",
      label: "Split into groups",
      description: "Keep the current strategy as Growth and add a Defensive group.",
      targetComponentId: splitTarget,
    });
  }
  return options;
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
  return null;
}
