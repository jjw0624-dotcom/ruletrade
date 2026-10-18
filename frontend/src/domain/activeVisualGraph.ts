import { entryBlockDefinition, entryConnectionAccepts, type EntryExecutionStatus } from "./entryStyleGrammar";
import type { ProgramWorkingDraft } from "./programWorkingDraft";

export type VisualGraphCapability = "incomplete" | "draft_only" | "ready" | "unsupported";

export interface ValidatedVisualGraph {
  rootId: string;
  blockIds: string[];
  capability: VisualGraphCapability;
  reasons: string[];
}

export interface VisualGraphValidation {
  status: "valid" | "invalid";
  graphs: ValidatedVisualGraph[];
  diagnostics: Array<{ code: string; blockId: string; message: string }>;
}

const graphCapability = (statuses: EntryExecutionStatus[], incomplete: boolean): VisualGraphCapability => {
  if (incomplete) return "incomplete";
  if (statuses.includes("draft_only")) return "draft_only";
  if (statuses.includes("needs_context")) return "unsupported";
  return "ready";
};

/**
 * Validates the user-selected graph without mutating Canonical. This is the
 * visual graph -> validated authoring intent boundary; semantic operations are
 * selected only after this result is valid and ready.
 */
export function validateActiveVisualGraphs(draft: ProgramWorkingDraft): VisualGraphValidation {
  const diagnostics: VisualGraphValidation["diagnostics"] = [];
  const children = new Map<string, string[]>();
  for (const connection of Object.values(draft.blockConnections)) {
    if (!connection.parentId) continue;
    children.set(connection.parentId, [...(children.get(connection.parentId) ?? []), connection.childId]);
    const parent = draft.canvasBlocks[connection.parentId];
    const child = draft.canvasBlocks[connection.childId];
    const parentDefinition = parent && entryBlockDefinition(parent.definitionId);
    const childDefinition = child && entryBlockDefinition(child.definitionId);
    if (!parentDefinition || !childDefinition) continue;
    const input = parentDefinition.slots.find((slot) => slot.name === connection.inputName);
    if (input && (!childDefinition.output || !entryConnectionAccepts(input.accepts, childDefinition.output))) {
      diagnostics.push({ code: "typed_connection_mismatch", blockId: child.id, message: `${childDefinition.label} cannot connect to ${parentDefinition.label}.${connection.inputName}` });
    }
  }
  const graphs = draft.activeGraphRootIds.flatMap((rootId): ValidatedVisualGraph[] => {
    const root = draft.canvasBlocks[rootId];
    if (!root) {
      diagnostics.push({ code: "missing_active_root", blockId: rootId, message: "The active graph root no longer exists." });
      return [];
    }
    const rootDefinition = entryBlockDefinition(root.definitionId);
    if (rootDefinition?.shape !== "hat") diagnostics.push({ code: "active_root_not_start", blockId: rootId, message: "An active strategy graph must begin with a Start block." });
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const child of children.get(id) ?? []) visit(child);
    };
    visit(rootId);
    const definitions = [...visited].map((id) => entryBlockDefinition(draft.canvasBlocks[id]?.definitionId ?? "")).filter((value): value is NonNullable<typeof value> => Boolean(value));
    let incomplete = false;
    for (const id of visited) {
      const block = draft.canvasBlocks[id];
      const definition = block && entryBlockDefinition(block.definitionId);
      if (!definition) continue;
      for (const slot of definition.slots) {
        if (!Object.values(draft.blockConnections).some((connection) => connection.parentId === id && connection.inputName === slot.name)) incomplete = true;
      }
    }
    const capability = graphCapability(definitions.map((definition) => definition.execution), incomplete);
    return [{ rootId, blockIds: [...visited], capability, reasons: incomplete ? ["Complete every required typed slot before committing this graph."] : capability === "draft_only" ? ["This graph contains a block whose execution contract is draft-only."] : capability === "unsupported" ? ["This complete graph is not supported by the current execution profile."] : [] }];
  });
  return { status: diagnostics.length ? "invalid" : "valid", graphs, diagnostics };
}
