import type { BacktestConfig } from "./domain/backtest";

export type MarketDataOverall = "available" | "partial" | "unavailable";
export type MarketDataReason =
  | "available"
  | "provider_unavailable"
  | "no_data"
  | "security_master_missing"
  | "insufficient_history"
  | "requested_period_unavailable"
  | "corrupt_cache";

export interface MarketDataSymbolRequirement {
  symbol: string;
  security_type: "equity";
  market: "usa";
  resolution: "daily";
  warmup_observations: number;
}

export interface MarketDataRequirement {
  dataset_id: string;
  requested_start: string;
  requested_end: string;
  normalization_mode: "adjusted";
  symbols: MarketDataSymbolRequirement[];
}

export interface MarketDataSymbolAvailability {
  symbol: string;
  status: "available" | "unavailable";
  reason: MarketDataReason;
  available_from: string | null;
  available_to: string | null;
  warmup_observations_required: number;
  warmup_observations_available: number;
}

export interface MarketDataPreflight {
  overall: MarketDataOverall;
  dataset_id: string;
  source_kind: "synthetic_fixture" | "local_lean_data";
  provider_id: string;
  requirement: MarketDataRequirement;
  symbols: MarketDataSymbolAvailability[];
  cache_hit: boolean;
  acquisition_supported: boolean;
  acquisition_reason: string | null;
  elapsed_ms: number;
}

export interface MarketDataApiDetail {
  code: string;
  message: string;
}

export class MarketDataApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: MarketDataApiDetail,
  ) {
    super(detail.message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return (await response.json()) as T;
  let payload: { detail?: MarketDataApiDetail | string } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // A request failure remains distinct from confirmed data unavailability.
  }
  const raw = payload.detail;
  const detail = raw && typeof raw === "object"
    ? raw
    : {
      code: "request_failed",
      message: typeof raw === "string" ? raw : `Preflight request failed (${response.status})`,
    };
  throw new MarketDataApiError(response.status, detail);
}

export const marketDataApi = {
  preflight: (
    revisionId: string,
    config: BacktestConfig,
    fetcher: typeof fetch = fetch,
  ) => request<MarketDataPreflight>(
    `/v1/revisions/${encodeURIComponent(revisionId)}/market-data/preflight`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    },
    fetcher,
  ),
};
