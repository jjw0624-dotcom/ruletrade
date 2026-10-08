import { jsonBody, readApiErrorDetail } from "./apiError";
import type { CanonicalStrategyV2 } from "./domain/canonicalV2";
import type { BacktestConfig, LeanBacktestResponse } from "./domain/backtest";

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

export interface V2ExecutionCapability {
  authorable: boolean;
  reference_valid: boolean;
  backend_lowerable: boolean;
  production_executable: boolean;
  required_symbols?: string[];
  reason: string | null;
}

export async function v2ExecutionCapability(strategy: CanonicalStrategyV2, fetcher: typeof fetch = fetch): Promise<V2ExecutionCapability> {
  const response = await fetcher("/api/v2/canonical/strategies/execution-capability", jsonBody("POST", strategy));
  if (!response.ok) throw new Error(`V2 capability check failed (${response.status})`);
  return await response.json() as V2ExecutionCapability;
}

export async function executeV2Lean(strategy: CanonicalStrategyV2, config: BacktestConfig, fetcher: typeof fetch = fetch): Promise<LeanBacktestResponse> {
  const response = await fetcher("/api/v2/backtests/lean", jsonBody("POST", { strategy, config }));
  if (!response.ok) {
    const detail = await readApiErrorDetail(response, `V2 backtest failed (${response.status})`);
    throw new Error(typeof detail === "object" && detail && "message" in detail ? String(detail.message) : "V2 backtest failed");
  }
  return await response.json() as LeanBacktestResponse;
}
