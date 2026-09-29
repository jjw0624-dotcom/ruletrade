import type { ConceptualFlowProjection } from "./conceptualFlow";
import type { DraftControlKind } from "./logicDraft";
import type { SemanticSelection } from "./semanticSelection";
import { semanticSelection } from "./semanticSelection";
import { constructionOptions, type ConstructionOption } from "./builderProjection";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";

export type ProgramToolboxCategory = "Control" | "Selection" | "Action" | "Timing" | "Behavior";
export type ProgramToolboxStatus = "available" | "draftable" | "existing" | "unsupported";

export interface ProgramToolboxEntry {
  id: string;
  category: ProgramToolboxCategory;
  label: string;
  description: string;
  status: ProgramToolboxStatus;
  statusLabel: string;
  options: ConstructionOption[];
  focusSelection: SemanticSelection | null;
  draftKind: DraftControlKind | null;
}

export const PROGRAM_TOOLBOX_CATEGORIES: ProgramToolboxCategory[] = [
  "Control",
  "Selection",
  "Action",
  "Timing",
  "Behavior",
];

function entry(
  value: Omit<ProgramToolboxEntry, "options" | "focusSelection" | "draftKind"> & Partial<Pick<ProgramToolboxEntry, "options" | "focusSelection" | "draftKind">>,
): ProgramToolboxEntry {
  return { options: [], focusSelection: null, draftKind: null, ...value };
}

export function blockyProgramToolboxEntries(
  projection: ConceptualFlowProjection,
  capabilities: StructuralAuthoringCapabilities | null,
  selection: SemanticSelection | null,
): ProgramToolboxEntry[] {
  const options = constructionOptions(projection, capabilities, selection);
  const option = (kinds: ConstructionOption["kind"][]) => options.filter((item) => kinds.includes(item.kind));
  const firstChoose = projection.groups.find((group) => group.choose)?.choose;
  const firstGroup = projection.groups[0];
  const selectionOptions = option(["metric", "choose"]);
  const eligibilityOptions = option(["qualification"]);
  const fallbackOptions = option(["fallback"]);
  const cooldownOptions = option(["cooldown"]);
  const scheduleId = firstGroup?.scheduleComponentId ?? projection.rebalanceScheduleComponentId;
  return [
    entry({
      id: "if",
      category: "Control",
      label: "If",
      description: "Draft one control branch without pretending it is executable Canonical.",
      status: "draftable",
      statusLabel: "Draft only",
      draftKind: "if",
    }),
    entry({
      id: "if-otherwise",
      category: "Control",
      label: "If / Otherwise",
      description: "Draft two control branches without changing Canonical.",
      status: "draftable",
      statusLabel: "Draft only",
      draftKind: "if_otherwise",
    }),
    entry({
      id: "choose-assets",
      category: "Selection",
      label: "Choose assets",
      description: "Choose candidates by the supported ranking and count semantics.",
      status: firstChoose ? "existing" : selectionOptions.length ? "available" : "unsupported",
      statusLabel: firstChoose ? "Present · focus" : selectionOptions.length ? "Available" : "Needs a compatible investment",
      options: firstChoose ? [] : selectionOptions.slice(0, 1),
      focusSelection: firstChoose
        ? semanticSelection("selection", firstChoose.selectionComponentId, { groupId: firstGroup?.id })
        : null,
    }),
    entry({
      id: "eligibility",
      category: "Selection",
      label: "Eligibility",
      description: "Configure candidate admission inside Selection; this is not a control IF.",
      status: firstChoose?.filterComponentId ? "existing" : eligibilityOptions.length ? "available" : "unsupported",
      statusLabel: firstChoose?.filterComponentId ? "Present · focus" : eligibilityOptions.length ? "Available" : "Requires ranked Selection",
      options: firstChoose?.filterComponentId ? [] : eligibilityOptions,
      focusSelection: firstChoose?.filterComponentId
        ? semanticSelection("qualification", firstChoose.filterComponentId, { fieldPath: "config.threshold", groupId: firstGroup?.id })
        : null,
    }),
    entry({
      id: "allocate",
      category: "Action",
      label: "Allocate",
      description: "Assign capital using the current supported allocation operation.",
      status: firstGroup?.allocationComponentId ? "existing" : "unsupported",
      statusLabel: firstGroup?.allocationComponentId ? "Present · focus" : "No executable allocation target",
      focusSelection: firstGroup?.allocationComponentId
        ? semanticSelection("rule", firstGroup.allocationComponentId, { groupId: firstGroup.id })
        : null,
    }),
    entry({
      id: "schedule",
      category: "Timing",
      label: "Schedule",
      description: "Start a Script with the current evaluation or rebalance trigger.",
      status: scheduleId ? "existing" : "unsupported",
      statusLabel: scheduleId ? "Present · focus" : "Trigger creation is not supported",
      focusSelection: scheduleId ? semanticSelection("schedule", scheduleId, { groupId: firstGroup?.id }) : null,
    }),
    entry({
      id: "selection-fallback",
      category: "Behavior",
      label: "Selection fallback",
      description: "Use a fallback asset only when the Selection is incomplete.",
      status: firstChoose?.fallbackComponentId ? "existing" : fallbackOptions.length ? "available" : "unsupported",
      statusLabel: firstChoose?.fallbackComponentId ? "Present · focus" : fallbackOptions.length ? "Available" : "Requires a compatible Selection",
      options: firstChoose?.fallbackComponentId ? [] : fallbackOptions,
      focusSelection: firstChoose?.fallbackComponentId
        ? semanticSelection("fallback", firstChoose.fallbackComponentId, { groupId: firstGroup?.id })
        : null,
    }),
    entry({
      id: "constraint",
      category: "Behavior",
      label: "Constraint",
      description: "Apply the supported Cooldown modifier without inventing a sequential action.",
      status: firstChoose?.cooldownComponentId ? "existing" : cooldownOptions.length ? "available" : "unsupported",
      statusLabel: firstChoose?.cooldownComponentId ? "Cooldown present · focus" : cooldownOptions.length ? "Available" : "Requires a compatible Selection",
      options: firstChoose?.cooldownComponentId ? [] : cooldownOptions,
      focusSelection: firstChoose?.cooldownComponentId
        ? semanticSelection("cooldown", firstChoose.cooldownComponentId, { fieldPath: "config.duration", groupId: firstGroup?.id })
        : null,
    }),
  ];
}
