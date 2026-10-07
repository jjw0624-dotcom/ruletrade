import type { CanonicalStrategyV1 } from "./domain/canonical";
import type { CanonicalStrategyV2 } from "./domain/canonicalV2";
export type CanonicalStrategy = CanonicalStrategyV1 | CanonicalStrategyV2;
import { jsonBody, readApiErrorDetail } from "./apiError";

export interface StrategyRecord { id: string; name: string; created_at: string; updated_at: string; current_revision_id: string; archived_at: string | null }
export interface RevisionRecord<T extends CanonicalStrategy = CanonicalStrategy> { id: string; strategy_id: string; parent_revision_id: string | null; canonical_strategy: T; source_hash: string; schema_version: string; created_at: string }
export interface RevisionSummary extends Omit<RevisionRecord, "canonical_strategy"> {}
export interface StrategyDetail<T extends CanonicalStrategy = CanonicalStrategy> { strategy: StrategyRecord; current_revision: RevisionRecord<T> }
export interface SaveRevisionResponse<T extends CanonicalStrategy = CanonicalStrategy> { created: boolean; strategy: StrategyRecord; revision: RevisionRecord<T> }
export type StrategyDetailV1 = StrategyDetail<CanonicalStrategyV1>;
export type StrategyDetailV2 = StrategyDetail<CanonicalStrategyV2>;
export interface StrategyApiDetail { code: string; message: string; current_revision_id?: string; issues?: Array<{ path: string; message: string }> }

export class StrategyApiError extends Error {
  constructor(public readonly status: number, public readonly detail: StrategyApiDetail) { super(detail.message); }
}

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  const detail = await readApiErrorDetail(response, `Request failed (${response.status})`) as StrategyApiDetail;
  throw new StrategyApiError(response.status, detail);
}

export const strategyApi = {
  list: (fetcher?: typeof fetch) => request<{ items: StrategyRecord[] }>("/v1/strategies", {}, fetcher),
  get: (id: string, fetcher?: typeof fetch, signal?: AbortSignal) => request<StrategyDetail>(`/v1/strategies/${encodeURIComponent(id)}`, { signal }, fetcher),
  create: (name: string, canonical: CanonicalStrategy, fetcher?: typeof fetch) => request<StrategyDetail>("/v1/strategies", jsonBody("POST", { name, canonical_strategy: canonical }), fetcher),
  rename: (id: string, name: string, fetcher?: typeof fetch) => request<StrategyDetail>(`/v1/strategies/${encodeURIComponent(id)}`, jsonBody("PATCH", { name }), fetcher),
  archive: (id: string, fetcher?: typeof fetch) => request<void>(`/v1/strategies/${encodeURIComponent(id)}`, { method: "DELETE" }, fetcher),
  save: <T extends CanonicalStrategy>(id: string, parentId: string, canonical: T, fetcher?: typeof fetch) => request<SaveRevisionResponse<T>>(`/v1/strategies/${encodeURIComponent(id)}/revisions`, jsonBody("POST", { expected_parent_revision_id: parentId, canonical_strategy: canonical }), fetcher),
  revisions: (id: string, fetcher?: typeof fetch) => request<{ items: RevisionSummary[] }>(`/v1/strategies/${encodeURIComponent(id)}/revisions`, {}, fetcher),
  revision: (id: string, revisionId: string, fetcher?: typeof fetch) => request<RevisionRecord>(`/v1/strategies/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}`, {}, fetcher),
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}

export function sameCanonicalSnapshot(a: CanonicalStrategy, b: CanonicalStrategy): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
