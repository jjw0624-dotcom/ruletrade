import type { JsonValue, ValueExpression } from "./domain/canonical";

export interface ValueCapability {
  id: string;
  label: string;
  input_types: string[];
  output_type: string;
  parameters: string[];
  canonical_supported: boolean;
  dataset_evaluation_supported: boolean;
  strategy_compiler_supported: boolean;
  provider_requirement: string;
  limitation: string | null;
}

export interface SemanticValueEvidence {
  subject_kind: "asset" | "candidate";
  subject_id: string;
  value_definition: Record<string, JsonValue>;
  value_type: string;
  observed: string;
  as_of: string;
  observed_at: string;
  context: "research" | "historical";
  provider_id: string;
  provenance: { component_id: string; field_path: "condition" | "value_expression" } | null;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Value semantics request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const valueSemanticsApi = {
  capabilities: (fetcher: typeof fetch = fetch) =>
    fetcher("/api/v1/canonical/value-capabilities").then(json<ValueCapability[]>),
  evaluate: (
    request: {
      dataset_id: string;
      expression: ValueExpression;
      as_of: string;
      context: "research" | "historical";
      candidate_asset?: string;
      provenance?: { component_id: string; field_path: "condition" | "value_expression" };
    },
    fetcher: typeof fetch = fetch,
  ) => fetcher("/api/v1/canonical/values/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }).then(json<SemanticValueEvidence>),
};
