import type { CanonicalStrategyV2, V2AuthoringOperation } from "./canonicalV2";
import { hasFlowCycle, validProgramBlockConnection, type ProgramDraftConnection } from "./programWorkingDraft";

export type DraftIntent =
  | { kind: "move_block"; objectId: string; position: { x: number; y: number } }
  | { kind: "move_flow_node"; objectId: string; position: { x: number; y: number } }
  | { kind: "set_flow_viewport"; viewport: { x: number; y: number; zoom: number } }
  | { kind: "connect_block"; childId: string; childType: "statement" | "condition" | "value" | "fallback"; parentId: string | null; inputName: string | null; projected?: ProgramDraftConnection }
  | { kind: "connect_flow"; sourceId: string; targetId: string; projectedEdges: Array<{ source: string; target: string }> }
  | { kind: "disconnect_flow"; sourceId: string; targetId: string; projectedEdges: Array<{ source: string; target: string }> }
  | { kind: "delete_visual_object"; objectId: string; projectionOnly: boolean };

export interface DraftIntentResult {
  status: "layout_only" | "draft_only" | "ready" | "invalid" | "unsupported";
  semanticEffect: "none" | "commit_operation";
  operation?: V2AuthoringOperation;
  diagnostic?: { code: string; productMessage: string; technicalDetail: string };
}

/**
 * Translate a visual gesture without parsing Blockly XML or ReactFlow nodes.
 * Only complete, explicitly supported intents produce a Canonical operation.
 */
export function translateDraftIntent(strategy: CanonicalStrategyV2, intent: DraftIntent): DraftIntentResult {
  if (intent.kind === "move_block" || intent.kind === "move_flow_node" || intent.kind === "set_flow_viewport") {
    return { status: "layout_only", semanticEffect: "none" };
  }
  if (intent.kind === "connect_block") {
    if (!validProgramBlockConnection("statement", intent.inputName, intent.childType)) {
      return {
        status: "invalid", semanticEffect: "none",
        diagnostic: { code: "incompatible_block_connection", productMessage: "These blocks cannot be connected in that position.", technicalDetail: `${intent.childType} cannot connect to ${intent.inputName ?? "root"}` },
      };
    }
    const sameAsProjection = intent.projected?.parentId === intent.parentId && intent.projected?.inputName === intent.inputName;
    return { status: sameAsProjection ? "layout_only" : "draft_only", semanticEffect: "none" };
  }
  if (intent.kind === "connect_flow") {
    if (hasFlowCycle(intent.projectedEdges, { source: intent.sourceId, target: intent.targetId })) {
      return {
        status: "invalid", semanticEffect: "none",
        diagnostic: { code: "capital_route_cycle", productMessage: "Capital routes cannot form a cycle.", technicalDetail: `${intent.sourceId} -> ${intent.targetId} introduces a cycle` },
      };
    }
    const targetInvestment = intent.targetId.startsWith("investment:");
    const alreadySplit = (strategy.program?.statements ?? []).some((statement) => statement.kind === "allocate" && statement.method === "fixed" && statement.legs.filter((leg) => leg.target.kind === "group").length > 1);
    if (intent.sourceId === "portfolio" && targetInvestment && strategy.definitions.groups.length === 2 && !alreadySplit) {
      return {
        status: "ready", semanticEffect: "commit_operation",
        operation: { kind: "set_program_split", investments: strategy.definitions.groups.map((group): [string, number] => [group.id, .5]) },
      };
    }
    return {
      status: "unsupported", semanticEffect: "none",
      diagnostic: { code: "unsupported_capital_route", productMessage: "This capital route is not authorable yet.", technicalDetail: `${intent.sourceId} -> ${intent.targetId} has no registered V2 semantic operation` },
    };
  }
  if (intent.kind === "disconnect_flow") {
    const projected = intent.projectedEdges.some((edge) => edge.source === intent.sourceId && edge.target === intent.targetId);
    if (!projected) return {
      status: "invalid", semanticEffect: "none",
      diagnostic: { code: "stale_capital_route", productMessage: "That capital route is no longer present.", technicalDetail: `${intent.sourceId} -> ${intent.targetId} is absent from the current Flow projection` },
    };
    const statements = strategy.program?.statements ?? [];
    const allocations = statements.filter((statement) => statement.kind === "allocate");
    const allocationId = (nodeId: string) => nodeId.startsWith("investment:") ? nodeId.slice("investment:".length).split(":")[0]! : null;
    if (intent.sourceId === "portfolio" && intent.targetId === "split") {
      const split = allocations.find((statement) => statement.method === "fixed" && statement.legs.length > 1);
      if (split) return { status: "ready", semanticEffect: "commit_operation", operation: { kind: "remove_program_investment_allocation", semantic_id: split.semantic_id } };
    }
    if (intent.sourceId === "portfolio" && allocationId(intent.targetId)) {
      return { status: "ready", semanticEffect: "commit_operation", operation: { kind: "remove_program_investment_allocation", semantic_id: allocationId(intent.targetId)! } };
    }
    if (allocationId(intent.sourceId) && !intent.targetId.startsWith("investment:")) {
      const semanticId = allocationId(intent.sourceId)!;
      const allocation = allocations.find((statement) => statement.semantic_id === semanticId);
      if (allocation?.legs.length === 1) return { status: "ready", semanticEffect: "commit_operation", operation: { kind: "remove_program_investment_allocation", semantic_id: semanticId } };
    }
    if (intent.targetId.startsWith("fallback:") && intent.sourceId === intent.targetId.slice("fallback:".length)) {
      return { status: "ready", semanticEffect: "commit_operation", operation: { kind: "set_program_fallback", semantic_id: intent.sourceId, fallback_asset: null } };
    }
    return {
      status: "unsupported", semanticEffect: "none",
      diagnostic: { code: "route_deletion_requires_semantic_operation", productMessage: "This route cannot be removed independently yet. The requested change remains in Flow as a draft.", technicalDetail: `${intent.sourceId} -> ${intent.targetId} has no lossless atomic V2 removal operation` },
    };
  }
  if (intent.projectionOnly) {
    return {
      status: "invalid", semanticEffect: "none",
      diagnostic: { code: "projection_object_not_semantic", productMessage: "This visual item is derived from another rule and cannot be deleted by itself.", technicalDetail: `${intent.objectId} is projection-only` },
    };
  }
  return {
    status: "unsupported", semanticEffect: "none",
    diagnostic: { code: "delete_operation_unregistered", productMessage: "Delete this item from its Inspector.", technicalDetail: `${intent.objectId} has no generic delete translation` },
  };
}
