import { jsonBody, readApiErrorDetail } from "./apiError";
import type { CanonicalStrategyV2 } from "./domain/canonicalV2";

export interface V2SelectionExecution {
  selected_assets: string[];
  complete: boolean;
  evidence: {
    semantic_id: string;
    universe_id: string;
    requested_members: string[];
    eligible_members: string[];
    unknown_members: string[];
    ranked_members: string[];
    selected_members: string[];
    shortage_policy: string;
    fallback_asset: string | null;
    fallback_used: boolean;
    comparisons: unknown[];
    ranking_observations: unknown[];
  };
}

export async function executeV2Selection(
  strategy: CanonicalStrategyV2,
  datasetId = "synthetic_prices",
  fetcher: typeof fetch = fetch,
): Promise<V2SelectionExecution> {
  const response = await fetcher("/api/v2/canonical/strategies/selection/evaluate", jsonBody("POST", {
    strategy,
    dataset_id: datasetId,
  }));
  if (!response.ok) {
    const detail = await readApiErrorDetail(response, `v2 execution failed (${response.status})`);
    throw new Error(typeof detail === "object" && detail && "message" in detail ? String(detail.message) : "v2 execution failed");
  }
  return await response.json() as V2SelectionExecution;
}
