import { jsonBody, readApiErrorDetail } from "./apiError";
import type { CanonicalStrategyV2 } from "./domain/canonicalV2";

export type StrategyCatalogId =
  | "single_asset_periodic"
  | "market_regime_rotation"
  | "growth_defensive"
  | "weighted_top_n";

export interface StrategyCatalogParameter {
  id: string;
  label: string;
  kind: "asset" | "assets" | "integer" | "decimal" | "timeframe" | "policy";
  required: boolean;
}

export interface StrategyCatalogEntry {
  id: StrategyCatalogId;
  version: number;
  name: string;
  description: string;
  parameters: StrategyCatalogParameter[];
}

export interface CreateCatalogStrategyResponse {
  catalog_id: StrategyCatalogId;
  catalog_version: number;
  strategy: CanonicalStrategyV2;
  source_hash: string;
}

export type CatalogStrategyRequest = Record<string, unknown> & {
  catalog_id: StrategyCatalogId;
  version: 1;
  name: string;
};

async function api<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return await response.json() as T;
  const detail = await readApiErrorDetail(response, `Catalog request failed (${response.status})`);
  const message = typeof detail === "object" && detail && "message" in detail
    ? String(detail.message)
    : typeof detail === "string" ? detail : "The strategy could not be created.";
  throw new Error(message);
}

export const strategyCatalogApi = {
  list: (fetcher?: typeof fetch) => api<StrategyCatalogEntry[]>("/v2/strategy-catalog", {}, fetcher),
  create: (request: CatalogStrategyRequest, fetcher?: typeof fetch) =>
    api<CreateCatalogStrategyResponse>("/v2/strategy-catalog/create", jsonBody("POST", request), fetcher),
};
