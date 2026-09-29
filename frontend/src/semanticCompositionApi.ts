import type { CanonicalStrategyV1 } from "./domain/canonical";

export type SemanticCategory =
  | "universe"
  | "measure"
  | "eligibility"
  | "predicate"
  | "selection"
  | "action"
  | "allocation"
  | "constraint"
  | "portfolio"
  | "timing"
  | "state";

export interface SemanticProjectionRef {
  primary_component_id: string | null;
  related_component_ids: string[];
  semantic_role: SemanticCategory;
  field_path: string | null;
  definition_id: string | null;
}

export interface SemanticFact {
  id: string;
  category: SemanticCategory;
  kind: string;
  label: string;
  ref: SemanticProjectionRef;
  detail: Record<string, unknown>;
}

export interface LogicStatement {
  id: string;
  family: "control" | "selection" | "action" | "portfolio_operation";
  kind: string;
  label: string;
  ref: SemanticProjectionRef;
  fact_ids: string[];
  modifier_fact_ids: string[];
  then_statement_ids: string[];
  else_statement_ids: string[];
}

export interface LogicScript {
  id: string;
  context_id: string;
  trigger: { timing_fact_id: string; ref: SemanticProjectionRef };
  statements: LogicStatement[];
  execution_order_semantic: true;
}

export interface LogicContext {
  id: string;
  kind: "portfolio" | "sleeve" | "investment" | "asset";
  label: string;
  ref: SemanticProjectionRef;
  fact_ids: string[];
  script_ids: string[];
}

export interface SemanticCompositionProjection {
  facts: SemanticFact[];
  logic: {
    contexts: LogicContext[];
    scripts: LogicScript[];
    placements: Array<{ fact_id: string; placement: string; unit_id: string | null }>;
  };
}

export const semanticCompositionApi = {
  async project(
    strategy: CanonicalStrategyV1,
    fetcher: typeof fetch = fetch,
  ): Promise<SemanticCompositionProjection> {
    const response = await fetcher("/api/v1/canonical/strategies/semantic-projections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(strategy),
    });
    if (!response.ok) throw new Error(`Semantic projection failed (${response.status})`);
    return await response.json() as SemanticCompositionProjection;
  },
};
