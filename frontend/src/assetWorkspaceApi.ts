export type AssetStatus = "available" | "partial" | "unavailable";
export interface AssetSummary { symbol: string; name: string; asset_type: "ETF" | "Equity"; data_status: AssetStatus; available_from: string | null; available_to: string | null }
export interface PricePoint { date: string; adjusted_close: string }
export interface AssetMetric { id: string; label: string; status: "available" | "insufficient_history" | "unavailable"; value?: string | null; value_type?: string | null; reason?: string | null; value_definition?: Record<string, unknown> | null }
export interface AssetMembership { kind: "asset_set" | "group" | "universe"; id: string; label: string }
export interface HistoricalAssetContext { run_id: string; event_id: string; session_id: string; revision_id: string; read_only: true; evidence: Array<Record<string, unknown>> }
export interface AssetDetail { asset: AssetSummary; as_of: string; mode: "current" | "historical"; series: PricePoint[]; metrics: AssetMetric[]; memberships: AssetMembership[]; historical?: HistoricalAssetContext | null; capabilities: Array<Record<string, unknown>> }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: { message?: string } | string };
    throw new Error(typeof payload.detail === "string" ? payload.detail : payload.detail?.message ?? `Asset research failed (${response.status})`);
  }
  return await response.json() as T;
}
export const assetWorkspaceApi = {
  list(query = "", datasetId = "synthetic_prices") {
    return request<{ items: AssetSummary[] }>(`/api/v1/assets?dataset_id=${encodeURIComponent(datasetId)}&query=${encodeURIComponent(query)}`);
  },
  detail(symbol: string, asOf: string, options: { datasetId?: string; strategyId?: string | null; revisionId?: string | null; runId?: string; eventId?: string } = {}) {
    const params = new URLSearchParams({ as_of: asOf, dataset_id: options.datasetId ?? "synthetic_prices" });
    if (options.strategyId) params.set("strategy_id", options.strategyId);
    if (options.revisionId) params.set("revision_id", options.revisionId);
    if (options.runId) params.set("run_id", options.runId);
    if (options.eventId) params.set("event_id", options.eventId);
    return request<AssetDetail>(`/api/v1/assets/${encodeURIComponent(symbol)}?${params}`);
  },
  compare(symbols: string[], asOf: string, datasetId = "synthetic_prices") {
    return request<{ as_of: string; items: AssetDetail[] }>("/api/v1/assets/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols, dataset_id: datasetId, as_of: asOf }) });
  },
};
