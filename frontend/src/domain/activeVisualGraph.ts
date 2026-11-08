import { entryBlockDefinition, entryConnectionAccepts, type EntryExecutionStatus } from "./entryStyleGrammar";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "./canonicalV2";
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

export interface ActiveVisualGraphCompilation {
  status: "ready" | "incomplete" | "unsupported" | "invalid";
  operation: V2AuthoringOperation | null;
  productMessage: string;
  rootId: string | null;
}

const graphCapability = (statuses: EntryExecutionStatus[], incomplete: boolean): VisualGraphCapability => {
  if (incomplete) return "incomplete";
  if (statuses.includes("draft_only")) return "draft_only";
  if (statuses.includes("needs_context")) return "unsupported";
  return "ready";
};

const startEventType = (definitionId: string) => definitionId.replace(/^start-/, "");

/**
 * Every connected Start block is an executable candidate. Disconnected
 * fragments remain valid working material and never need an activation flag.
 * This is the visual graph -> validated authoring intent boundary.
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
  const rootIds = Object.values(draft.canvasBlocks)
    .filter((block) => entryBlockDefinition(block.definitionId)?.shape === "hat")
    .map((block) => block.id);
  const rootsByEvent = new Map<string, string[]>();
  for (const rootId of rootIds) {
    const eventType = startEventType(draft.canvasBlocks[rootId]!.definitionId);
    rootsByEvent.set(eventType, [...(rootsByEvent.get(eventType) ?? []), rootId]);
  }
  for (const [eventType, ids] of rootsByEvent) if (ids.length > 1) {
    for (const blockId of ids) diagnostics.push({ code: "duplicate_start_event_type", blockId, message: `Only one ${eventType.replaceAll("-", " ")} Start is allowed.` });
  }
  const graphs = rootIds.flatMap((rootId): ValidatedVisualGraph[] => {
    const root = draft.canvasBlocks[rootId]!;
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
    return [{ rootId, blockIds: [...visited], capability, reasons: incomplete ? ["Complete every required typed slot before testing this graph."] : capability === "draft_only" ? ["This graph contains a block whose execution contract is draft-only."] : capability === "unsupported" ? ["This complete graph is not supported by the current execution profile."] : [] }];
  });
  return { status: diagnostics.length ? "invalid" : "valid", graphs, diagnostics };
}

/**
 * Compiles only the deliberately small, proven Blocky subset. Validation and
 * compilation are separate so a complete but unsupported graph remains an
 * honest draft instead of being coerced into different financial semantics.
 */
export function compileActiveVisualGraph(draft: ProgramWorkingDraft, canonical?: CanonicalStrategyV2): ActiveVisualGraphCompilation {
  const validation = validateActiveVisualGraphs(draft);
  if (validation.status === "invalid") return { status: "invalid", operation: null, productMessage: validation.diagnostics[0]?.message ?? "Correct the typed Blocky connections before testing.", rootId: null };
  if (validation.graphs.length !== 1) return { status: validation.graphs.length ? "unsupported" : "incomplete", operation: null, productMessage: validation.graphs.length ? "Multiple event graphs are preserved, but this execution profile currently commits one event graph at a time." : "Connect a complete action to a Start block before testing.", rootId: null };
  const graph = validation.graphs[0]!;
  if (graph.capability === "incomplete") return { status: "incomplete", operation: null, productMessage: graph.reasons[0]!, rootId: graph.rootId };
  if (graph.capability !== "ready") return { status: "unsupported", operation: null, productMessage: graph.reasons[0]!, rootId: graph.rootId };
  const root = draft.canvasBlocks[graph.rootId]!;
  const childAt = (parentId: string, inputName: string) => {
    const connection = Object.values(draft.blockConnections).find((item) => item.parentId === parentId && item.inputName === inputName);
    return connection ? draft.canvasBlocks[connection.childId] ?? null : null;
  };
  const action = childAt(root.id, "NEXT");
  const target = action && childAt(action.id, "TARGET");
  const weight = action && childAt(action.id, "WEIGHT");
  const timeframe = root.definitionId === "start-daily" ? "daily" : root.definitionId === "start-monthly" ? "monthly" : null;
  const percent = Number(weight?.fieldValues?.VALUE ?? Number.NaN);
  const targetRef = target?.objectRef ?? String(target?.fieldValues?.REFERENCE ?? "");
  const targetKind = target?.definitionId === "asset-reference" ? "asset" : target?.definitionId === "group-reference" ? "group" : null;
  if (!timeframe || action?.definitionId !== "rebalance" || !targetKind || weight?.definitionId !== "percentage" || percent !== 100 || !targetRef) {
    return { status: "unsupported", operation: null, productMessage: "This complete graph is preserved, but the current compiler supports only a daily or monthly 100% rebalance into one Asset or reusable Group.", rootId: graph.rootId };
  }
  const suffix = graph.rootId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "graph";
  if (targetKind === "asset") {
    return {
      status: "ready",
      rootId: graph.rootId,
      productMessage: `${targetRef} will rebalance to 100% on each ${timeframe} close.`,
      operation: { kind: "commit_single_asset_intent", investment_id: `investment-${suffix}`, investment_name: "Investment", asset_set_id: `investment-${suffix}-assets`, asset: targetRef, timeframe, timing_meaning: "rebalance" },
    };
  }
  const group = canonical?.definitions.groups.find((item) => item.id === targetRef);
  if (!group) {
    return { status: "unsupported", operation: null, productMessage: "This Group reference is preserved, but it no longer resolves to a reusable Group in this strategy.", rootId: graph.rootId };
  }
  const clock = canonical?.program?.clocks.find((item) => item.timeframe === timeframe && item.boundary === "close" && item.completed_only);
  if (!clock) {
    return { status: "unsupported", operation: null, productMessage: `Add a completed ${timeframe}-close clock before testing this Group rebalance.`, rootId: graph.rootId };
  }
  return {
    status: "ready",
    rootId: graph.rootId,
    productMessage: `${group.name} will rebalance to 100% on each ${timeframe} close.`,
    operation: { kind: "set_program_investment", semantic_id: `blocky-investment-${suffix}`, target_kind: "group", target_ref: group.id, internal_allocation: "equal", clock_id: clock.id },
  };
}
