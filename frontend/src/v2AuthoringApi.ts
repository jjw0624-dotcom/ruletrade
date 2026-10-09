import { jsonBody, readApiErrorDetail } from "./apiError";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "./domain/canonicalV2";

export interface V2AuthoringCapability {
  operation_id: string;
  label: string;
  available: boolean;
  reason: string | null;
  semantic_status?: "executable" | "reference_only" | "unavailable";
  reference_evaluable?: boolean;
  backend_lowerable?: boolean;
  authoring_reachable?: boolean;
  production_ready?: boolean;
}

export class V2AuthoringApiError extends Error {
  constructor(public readonly status: number, public readonly detail: { code: string; path?: string; message: string }) {
    super(detail.message);
  }
}

const PRODUCT_ERROR_MESSAGES: Record<string, string> = {
  duplicate_asset: "Each symbol can appear only once in this investment.",
  asset_set_not_found: "This investment's asset list no longer exists. Reopen the strategy and try again.",
  program_role_mismatch: "That rule cannot be used in this part of the strategy.",
  program_identity_change: "This edit would replace the selected rule instead of updating it.",
  program_statement_not_found: "The selected rule no longer exists. Reopen the strategy and try again.",
  unbound_candidate: "Candidate values can only be used inside Qualification or Selection ranking.",
  candidate_domain_mismatch: "This value belongs to a different investment universe.",
  invalid_reduction: "Choose how the multi-asset value should be reduced before using it here.",
  incomplete_program: "Finish the current rule before saving this strategy.",
};

export function v2AuthoringErrorMessage(reason: unknown): string {
  if (!(reason instanceof V2AuthoringApiError)) return reason instanceof Error ? reason.message : "This semantic edit is invalid.";
  return PRODUCT_ERROR_MESSAGES[reason.detail.code] ?? reason.detail.message;
}

export const v2AuthoringApi = {
  async programTemplate(name: string, assets: string[] = [], fetcher: typeof fetch = fetch, startingPoint?: string): Promise<CanonicalStrategyV2> {
    const response = await fetcher("/api/v2/canonical/authoring/program-template", jsonBody("POST", { name, assets, ...(startingPoint ? { starting_point: startingPoint } : {}) }));
    if (!response.ok) throw new Error(`Program template creation failed (${response.status})`);
    return await response.json() as CanonicalStrategyV2;
  },
  async capabilities(fetcher: typeof fetch = fetch): Promise<V2AuthoringCapability[]> {
    const response = await fetcher("/api/v2/canonical/authoring/capabilities");
    if (!response.ok) throw new Error(`Capability discovery failed (${response.status})`);
    return await response.json() as V2AuthoringCapability[];
  },

  async apply(
    strategy: CanonicalStrategyV2,
    expectedSourceHash: string,
    operation: V2AuthoringOperation,
    fetcher: typeof fetch = fetch,
  ): Promise<{ strategy: CanonicalStrategyV2; source_hash: string }> {
    const response = await fetcher("/api/v2/canonical/authoring/apply", jsonBody("POST", {
      strategy,
      expected_source_hash: expectedSourceHash,
      operation,
    }));
    if (!response.ok) {
      const detail = await readApiErrorDetail(response, `v2 authoring failed (${response.status})`) as { code: string; path?: string; message: string };
      throw new V2AuthoringApiError(response.status, detail);
    }
    return await response.json() as { strategy: CanonicalStrategyV2; source_hash: string };
  },
};
