import type { BacktestRunRecord } from "./backtestRunApi";
import type { CanonicalStrategyV1 } from "./domain/canonical";
import type { SaveRevisionResponse } from "./strategyApi";
import { jsonBody, readApiErrorDetail } from "./apiError";

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
export interface CandidateErrorDetail { code: string; message: string; current_revision_id?: string }
export class CandidateApiError extends Error { constructor(public status: number, public detail: CandidateErrorDetail) { super(detail.message); } }

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return response.json() as Promise<T>;
  const detail = await readApiErrorDetail(response, `Candidate request failed (${response.status})`) as CandidateErrorDetail;
  throw new CandidateApiError(response.status, detail);
}

export const candidateApi = {
  create: (runId: string, change: FilterThresholdChange, originatingDecisionEventId: string | null, fetcher?: typeof fetch) => request<CandidateExecution>(`/v1/backtest-runs/${encodeURIComponent(runId)}/candidates`, jsonBody("POST", { change, originating_decision_event_id: originatingDecisionEventId }), fetcher),
  get: (candidateId: string, fetcher?: typeof fetch) => request<CandidateExecution>(`/v1/candidates/${encodeURIComponent(candidateId)}`, {}, fetcher),
  adopt: (candidateId: string, expectedCurrentRevisionId: string, fetcher?: typeof fetch) => request<SaveRevisionResponse>(`/v1/candidates/${encodeURIComponent(candidateId)}/adopt`, jsonBody("POST", { expected_current_revision_id: expectedCurrentRevisionId }), fetcher),
};
