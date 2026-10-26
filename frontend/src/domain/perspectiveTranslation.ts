import type { CanonicalStrategyV2, V2AuthoringOperation } from "./canonicalV2";
import {
  projectProgramBlocky,
  projectProgramCapitalFlow,
  type ProgramBlockNode,
  type ProgramProjectionAddress,
} from "./programProjections";
import type { ProductFlowEdge, ProductFlowNode } from "./productSemantics";

export const PERSPECTIVE_TRANSLATION_SCHEMA = "ruletrade.dev/perspective-translation/v2" as const;

export type PerspectiveAvailability = "editable" | "draft_only" | "read_only" | "unsupported";
export interface PerspectiveCapability {
  representable: boolean;
  referenceEvaluable: boolean | null;
  backendLowerable: boolean;
  dockerVerified: boolean | null;
  providerSupported: boolean | null;
  uiAuthorable: boolean;
  runtimeAvailable: boolean | null;
}

export interface PerspectiveDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  address?: ProgramProjectionAddress;
}

export interface CapitalFlowPerspective {
  schemaVersion: "ruletrade.dev/capital-flow-manifest/v2";
  semanticIdentity: string;
  nodes: Array<ProductFlowNode & {
    sourceSemanticAddresses: ProgramProjectionAddress[];
    meaningRole: "context" | "ownership" | "routing" | "exposure" | "realization";
    capability: PerspectiveAvailability;
    editOperation: V2AuthoringOperation["kind"] | null;
  }>;
  edges: Array<ProductFlowEdge & {
    kind: "ownership_share" | "conditional_target" | "fallback_on_shortage" | "target_contribution" | "realization";
  }>;
  diagnostics: PerspectiveDiagnostic[];
  capability: PerspectiveCapability;
}

export interface DecisionLogicPerspective {
  schemaVersion: "ruletrade.dev/decision-logic-manifest/v2";
  semanticIdentity: string;
  blocks: Array<ProgramBlockNode & {
    sourceSemanticAddresses: ProgramProjectionAddress[];
    abstractionLevel: 0 | 1 | 2;
    capability: PerspectiveAvailability;
    editOperation: V2AuthoringOperation["kind"] | null;
  }>;
  diagnostics: PerspectiveDiagnostic[];
  capability: PerspectiveCapability;
}

export interface PerspectiveBundle {
  schemaVersion: typeof PERSPECTIVE_TRANSLATION_SCHEMA;
  semanticIdentity: string;
  capitalFlow: CapitalFlowPerspective;
  decisionLogic: DecisionLogicPerspective;
}

/** Stable committed meaning identity. Layout and draft state are absent by design. */
export function canonicalSemanticIdentity(strategy: CanonicalStrategyV2): string {
  return JSON.stringify(strategy);
}

function defaultCapability(backendLowerable = false): PerspectiveCapability {
  return {
    representable: true,
    referenceEvaluable: null,
    backendLowerable,
    dockerVerified: null,
    providerSupported: null,
    uiAuthorable: true,
    runtimeAvailable: null,
  };
}

function blockEditOperation(role: ProgramBlockNode["role"]): V2AuthoringOperation["kind"] | null {
  if (role === "group") return "rename_program_group";
  if (role === "selection") return "set_program_selection";
  if (role === "investment") return "set_program_investment";
  if (role === "split") return "set_program_split";
  if (role === "fallback") return "set_program_fallback";
  if (role === "allocation" || role === "policy") return "set_program_allocation";
  if (role === "condition" || role === "control") return "set_program_condition";
  if (role === "value" || role === "memory") return "set_program_value";
  if (role === "event") return "set_program_event";
  if (role === "state") return "set_program_transition";
  return null;
}

function flowEditOperation(node: ProductFlowNode): V2AuthoringOperation["kind"] | null {
  if (node.id === "split") return "set_program_split";
  if (node.id.startsWith("investment:")) return "set_program_investment";
  if (node.role === "timing") return "set_program_schedule";
  if (node.address.concept === "subgroup" || node.address.concept === "selection") return "set_program_selection";
  if (node.id.startsWith("fallback:")) return "set_program_fallback";
  return null;
}

export function derivePerspectiveBundle(
  strategy: CanonicalStrategyV2,
  capability: PerspectiveCapability = defaultCapability(),
): PerspectiveBundle {
  const semanticIdentity = canonicalSemanticIdentity(strategy);
  const flow = projectProgramCapitalFlow(strategy);
  const logic = projectProgramBlocky(strategy);
  const capitalFlow: CapitalFlowPerspective = {
    schemaVersion: "ruletrade.dev/capital-flow-manifest/v2",
    semanticIdentity,
    nodes: flow.nodes.map((node) => {
      const semanticId = node.address.canonical === "v2" ? node.address.semanticId : node.id;
      const address: ProgramProjectionAddress = {
        kind: ["timing", "rebalance"].includes(node.address.concept) ? "clock" : node.address.concept === "portfolio" ? "strategy" : "statement",
        semanticId,
        canonicalPath: semanticId,
        focusId: node.focusId ?? node.id,
      };
      const editOperation = flowEditOperation(node);
      const meaningRole = node.role === "portfolio" ? "context" as const
        : node.role === "capital" ? "ownership" as const
          : node.role === "routing" ? "routing" as const
            : node.role === "timing" ? "realization" as const : "exposure" as const;
      return {
        ...node,
        sourceSemanticAddresses: [address],
        meaningRole,
        capability: editOperation ? "editable" as const : "read_only" as const,
        editOperation,
      };
    }),
    edges: flow.edges.map((edge) => ({
      ...edge,
      kind: edge.label === "if incomplete" ? "fallback_on_shortage" as const
        : edge.label === "selected" ? "conditional_target" as const
          : edge.role === "action" ? "realization" as const
            : edge.role === "routing" ? "ownership_share" as const : "target_contribution" as const,
    })),
    diagnostics: [],
    capability,
  };
  const decisionLogic: DecisionLogicPerspective = {
    schemaVersion: "ruletrade.dev/decision-logic-manifest/v2",
    semanticIdentity,
    blocks: logic.map((block) => {
      const editOperation = blockEditOperation(block.role);
      return {
        ...block,
        sourceSemanticAddresses: [block.address],
        abstractionLevel: ["condition", "value"].includes(block.role) ? 1 as const : 0 as const,
        capability: editOperation ? "editable" as const : "read_only" as const,
        editOperation,
      };
    }),
    diagnostics: [],
    capability,
  };
  return { schemaVersion: PERSPECTIVE_TRANSLATION_SCHEMA, semanticIdentity, capitalFlow, decisionLogic };
}

export function perspectivesPreserveMeaning(before: PerspectiveBundle, after: PerspectiveBundle): boolean {
  return before.semanticIdentity === after.semanticIdentity
    && before.capitalFlow.semanticIdentity === after.capitalFlow.semanticIdentity
    && before.decisionLogic.semanticIdentity === after.decisionLogic.semanticIdentity;
}
