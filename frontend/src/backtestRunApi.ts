import type { BacktestConfig, BacktestResult, BacktestTimings } from "./domain/backtest";
import { jsonBody, readApiErrorDetail } from "./apiError";

export type BacktestRunStatus = "pending" | "running" | "succeeded" | "failed";

export interface BacktestRunProvenance {
  source_hash: string;
  strategy_schema_version: string;
  application_version: string;
  build_commit: string | null;
  backend_id: "lean";
  engine_image: string | null;
  dataset_id: string;
  dataset_version: string | null;
}

export interface BacktestRunRecord {
  id: string;
  revision_id: string;
  candidate_id?: string | null;
  status: BacktestRunStatus;
  run_config: BacktestConfig;
  result: BacktestResult | null;
  error: { code: string; message: string } | null;
  provenance: BacktestRunProvenance;
  timings: BacktestTimings;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface BacktestRunApiDetail { code: string; message: string; issues?: Array<{ path: string; message: string }> }

export class BacktestRunApiError extends Error {
  constructor(public readonly status: number, public readonly detail: BacktestRunApiDetail) { super(detail.message); }
}

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return (await response.json()) as T;
  const detail = await readApiErrorDetail(response, `Backtest request failed (${response.status})`) as BacktestRunApiDetail;
  throw new BacktestRunApiError(response.status, detail);
}

export const backtestRunApi = {
  create: (revisionId: string, config: BacktestConfig, fetcher?: typeof fetch) => request<BacktestRunRecord>(`/v1/revisions/${encodeURIComponent(revisionId)}/backtest-runs`, jsonBody("POST", { config }), fetcher),
  list: (revisionId: string, fetcher?: typeof fetch) => request<{ items: BacktestRunRecord[] }>(`/v1/revisions/${encodeURIComponent(revisionId)}/backtest-runs`, {}, fetcher),
  get: (runId: string, fetcher?: typeof fetch) => request<BacktestRunRecord>(`/v1/backtest-runs/${encodeURIComponent(runId)}`, {}, fetcher),
};
