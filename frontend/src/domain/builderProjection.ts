import type { ConceptualFlowProjection, ConceptualGroup } from "./conceptualFlow";
import { semanticSelection, type SemanticSelection } from "./semanticSelection";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../structuralAuthoringApi";
import type { RegistryPayload } from "./canonical";

export type BuilderBlockKind = "metric" | "choose" | "qualification" | "fallback" | "cooldown" | "split";

export interface StructureItem {
  id: string;
  label: string;
  detail?: string;
  selection: SemanticSelection;
  children: StructureItem[];
}

export interface ConstructionOption {
  kind: BuilderBlockKind;
  category: "Portfolio" | "Decision / routing";
  label: string;
  description: string;
  targetComponentId: string;
  targetLabel: string;
  groupId: string | null;
  anchorSelection: SemanticSelection;
}

export type ToolboxCategory = "Portfolio" | "Assets" | "Decision / logic" | "Timing";
export type ToolboxAvailability = "available_now" | "needs_context" | "unavailable" | "unsupported";

export interface SemanticToolboxEntry {
  id: string;
  category: ToolboxCategory;
  label: string;
  description: string;
  availability: ToolboxAvailability;
  availabilityLabel: string;
  options: ConstructionOption[];
}

type ToolboxDefinition = Omit<SemanticToolboxEntry, "availability" | "availabilityLabel" | "options"> & {
  primitives: string[];
  operationKind?: BuilderBlockKind;
  perspectives: Array<"flow" | "blocky">;
};

const TOOLBOX_DEFINITIONS: ToolboxDefinition[] = [
  { id: "investment", category: "Portfolio", label: "Investment", description: "A capital path backed by an asset set and allocation.", primitives: ["asset_set@1", "equal_weight@1"], perspectives: ["flow"] },
  { id: "split", category: "Portfolio", label: "Split", description: "Split capital into two valid sleeves.", primitives: ["asset_set@1", "equal_weight@1", "portfolio_sleeve@1", "portfolio@1"], operationKind: "split", perspectives: ["flow"] },
  { id: "sleeve", category: "Portfolio", label: "Sleeve", description: "A named allocation branch inside a portfolio.", primitives: ["portfolio_sleeve@1"], perspectives: ["flow"] },
  { id: "allocation", category: "Portfolio", label: "Allocation", description: "Convert selected assets into portfolio targets.", primitives: ["equal_weight@1"], perspectives: ["flow"] },
  { id: "asset-set", category: "Assets", label: "Asset Set", description: "A named universe of investable assets.", primitives: ["asset_set@1"], perspectives: ["flow", "blocky"] },
  { id: "metric", category: "Decision / logic", label: "Metric", description: "Measure trailing return for an asset universe.", primitives: ["trailing_return@1", "rank@1", "top_n@1"], operationKind: "metric", perspectives: ["flow", "blocky"] },
  { id: "condition", category: "Decision / logic", label: "Condition", description: "Require the supported return threshold before ranking.", primitives: ["filter@1"], operationKind: "qualification", perspectives: ["flow", "blocky"] },
  { id: "rank", category: "Decision / logic", label: "Rank", description: "Order scored assets from strongest to weakest.", primitives: ["rank@1"], perspectives: ["flow", "blocky"] },
  { id: "choose", category: "Decision / logic", label: "Choose", description: "Choose the strongest assets from a universe.", primitives: ["trailing_return@1", "rank@1", "top_n@1"], operationKind: "choose", perspectives: ["flow", "blocky"] },
  { id: "fallback", category: "Decision / logic", label: "Fallback", description: "Route incomplete selections to a fallback asset.", primitives: ["fallback@1"], operationKind: "fallback", perspectives: ["flow", "blocky"] },
  { id: "cooldown", category: "Decision / logic", label: "Cooldown", description: "Wait before buying the same asset again.", primitives: ["cooldown@1"], operationKind: "cooldown", perspectives: ["flow", "blocky"] },
  { id: "schedule", category: "Timing", label: "Schedule", description: "Choose when the Strategy evaluates and rebalances.", primitives: ["daily@1", "monthly@1"], perspectives: ["flow", "blocky"] },
];

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
  const composable = new Set(capabilities.composition?.primitives
    .filter((item) => item.create_supported).map((item) => item.primitive) ?? []);
  const options: ConstructionOption[] = [];
  for (const group of projection.groups) {
    const groupId = group.id;
    const targetLabel = group.label || "Investment";
    const chooseTarget = group.allocationComponentId;
    if (chooseTarget && capabilities.choose_pipeline_targets.includes(chooseTarget)
      && ["trailing_return@1", "rank@1", "top_n@1"].every((primitive) => composable.has(primitive))) options.push({
      kind: "metric", category: "Decision / routing", label: "Metric", targetLabel, groupId,
      description: "Add trailing return with the minimum Rank and Choose support required for a valid executable pipeline.",
      targetComponentId: chooseTarget,
      anchorSelection: semanticSelection("universe", group.universeComponentId ?? chooseTarget, { groupId }),
    });
    if (chooseTarget && capabilities.choose_pipeline_targets.includes(chooseTarget)) options.push({
      kind: "choose", category: "Decision / routing", label: "Choose", targetLabel, groupId,
      description: "Measure returns, rank this universe, and choose the strongest assets.",
      targetComponentId: chooseTarget,
      anchorSelection: semanticSelection("universe", group.universeComponentId ?? chooseTarget, { groupId }),
    });
    const rankTarget = group.choose?.rankComponentId;
    if (rankTarget && composable.has("filter@1") && capabilities.qualification_add_targets.includes(rankTarget)) options.push({
      kind: "qualification", category: "Decision / routing", label: "Condition", targetLabel, groupId,
      description: "Require the supported positive-return condition before ranking.",
      targetComponentId: rankTarget,
      anchorSelection: semanticSelection("selection", group.choose!.selectionComponentId, { groupId }),
    });
    const fallbackTarget = group.allocationComponentId;
    if (fallbackTarget && capabilities.fallback_add_targets.includes(fallbackTarget)) options.push({
      kind: "fallback", category: "Decision / routing", label: "Fallback", targetLabel, groupId,
      description: "Choose where money goes when too few assets qualify.",
      targetComponentId: fallbackTarget,
      anchorSelection: semanticSelection("selection", group.choose?.selectionComponentId ?? fallbackTarget, { groupId }),
    });
    const cooldownTarget = group.choose?.selectionComponentId;
    if (cooldownTarget && capabilities.cooldown_add_targets.includes(cooldownTarget)) options.push({
      kind: "cooldown", category: "Decision / routing", label: "Cooldown", targetLabel, groupId,
      description: "After selling, wait before buying the same asset again.",
      targetComponentId: cooldownTarget,
      anchorSelection: semanticSelection("selection", cooldownTarget, { groupId }),
    });
  }
  const splitTarget = capabilities.growth_defensive_targets[0];
  if (splitTarget && ["asset_set@1", "equal_weight@1", "portfolio_sleeve@1", "portfolio@1"]
    .every((primitive) => composable.has(primitive))) {
    options.push({
      kind: "split",
      category: "Portfolio",
      label: "Split",
      targetLabel: "Portfolio",
      groupId: null,
      description: "Split capital into two valid sleeves and set their initial allocation.",
      targetComponentId: splitTarget,
      anchorSelection: semanticSelection("portfolio", projection.portfolioComponentId ?? splitTarget),
    });
  }
  return options.sort((left, right) => Number(right.groupId === selection?.groupId) - Number(left.groupId === selection?.groupId));
}

export function semanticToolboxEntries(
  projection: ConceptualFlowProjection,
  registry: RegistryPayload,
  capabilities: StructuralAuthoringCapabilities | null,
  selection: SemanticSelection | null,
  perspective: "flow" | "blocky",
): SemanticToolboxEntry[] {
  const registryIds = new Set(registry.primitives.map((primitive) => primitive.id));
  const composition = new Map(capabilities?.composition?.primitives.map((item) => [item.primitive, item]) ?? []);
  const legalOptions = constructionOptions(projection, capabilities, selection);
  return TOOLBOX_DEFINITIONS.filter((definition) => definition.perspectives.includes(perspective))
    .filter((definition) => definition.primitives.every((primitive) => registryIds.has(primitive)))
    .map((definition) => {
      const options = definition.operationKind
        ? legalOptions.filter((option) => option.kind === definition.operationKind)
        : [];
      if (options.length > 0) return {
        ...definition, options, availability: "available_now" as const,
        availabilityLabel: options.length === 1 ? "Available now" : `${options.length} valid locations`,
      };
      const unsupported = definition.primitives.map((primitive) => composition.get(primitive))
        .find((item) => item && !item.create_supported);
      if (unsupported) return {
        ...definition, options, availability: "unsupported" as const,
        availabilityLabel: unsupported.reason ?? "Not supported by the current composition grammar.",
      };
      if (definition.operationKind) return {
        ...definition, options, availability: "needs_context" as const,
        availabilityLabel: "Needs a compatible Strategy location; no legal target exists right now.",
      };
      return {
        ...definition, options, availability: "unavailable" as const,
        availabilityLabel: "Executable primitive; standalone insertion is not yet a supported authoring operation.",
      };
    });
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
