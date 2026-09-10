import type { BacktestRunRecord } from "./backtestRunApi";
import type { CanonicalStrategyV1 } from "./domain/canonical";

export interface FilterThresholdChange {
  kind: "filter_threshold";
  component_id: string;
  field_path: "config.threshold";
  expected_before: string;
  proposed_after: string;
}

export interface CandidateRecord {
  id: string;
  base_revision_id: string;
  originating_run_id: string | null;
  originating_decision_event_id: string | null;
  change: FilterThresholdChange;
  canonical_strategy: CanonicalStrategyV1;
  source_hash: string;
  schema_version: string;
  created_at: string;
}

export interface CandidateExecution { candidate: CandidateRecord; run: BacktestRunRecord }
export interface CandidateErrorDetail { code: string; message: string }
export class CandidateApiError extends Error { constructor(public status: number, public detail: CandidateErrorDetail) { super(detail.message); } }

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return response.json() as Promise<T>;
  let payload: { detail?: CandidateErrorDetail | string } = {};
  try { payload = await response.json() as typeof payload; } catch { /* safe fallback */ }
  const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : { code: "request_failed", message: typeof payload.detail === "string" ? payload.detail : `Candidate request failed (${response.status})` };
  throw new CandidateApiError(response.status, detail);
}

export const candidateApi = {
  create: (runId: string, change: FilterThresholdChange, originatingDecisionEventId: string | null, fetcher?: typeof fetch) => request<CandidateExecution>(`/v1/backtest-runs/${encodeURIComponent(runId)}/candidates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change, originating_decision_event_id: originatingDecisionEventId }) }, fetcher),
  get: (candidateId: string, fetcher?: typeof fetch) => request<CandidateExecution>(`/v1/candidates/${encodeURIComponent(candidateId)}`, {}, fetcher),
};
