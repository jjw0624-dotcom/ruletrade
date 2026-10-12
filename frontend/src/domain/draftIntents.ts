import type { CanonicalStrategyV2, V2AuthoringOperation } from "./canonicalV2";
import { hasFlowCycle, validProgramBlockConnection, type ProgramDraftConnection } from "./programWorkingDraft";

export type DraftIntent =
  | { kind: "move_block"; objectId: string; position: { x: number; y: number } }
  | { kind: "move_flow_node"; objectId: string; position: { x: number; y: number } }
  | { kind: "set_flow_viewport"; viewport: { x: number; y: number; zoom: number } }
  | { kind: "connect_block"; childId: string; childType: "statement" | "condition" | "value" | "fallback"; parentId: string | null; inputName: string | null; projected?: ProgramDraftConnection }
  | { kind: "connect_flow"; sourceId: string; targetId: string; projectedEdges: Array<{ source: string; target: string }> }
  | { kind: "disconnect_flow"; sourceId: string; targetId: string }
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
  if (["move_block", "move_flow_node", "set_flow_viewport"].includes(intent.kind)) {
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
    return {
      status: "unsupported", semanticEffect: "none",
      diagnostic: { code: "route_deletion_requires_semantic_operation", productMessage: "Remove this route from its Inspector.", technicalDetail: "Flow edge deletion is not a generic Canonical delete" },
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
