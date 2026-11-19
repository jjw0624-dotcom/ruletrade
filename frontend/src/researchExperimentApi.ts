import { jsonBody, readApiErrorDetail } from "./apiError";
import type { BacktestConfig } from "./domain/backtest";
import type { CanonicalStrategyV2 } from "./domain/canonicalV2";
import type { BacktestRunRecord } from "./backtestRunApi";

export type CatalogBaseRequest = Record<string, unknown> & {
  catalog_id: string;
  version: number;
  name: string;
};

export interface ExperimentCandidateRecord {
  id: string;
  experiment_id: string;
  ordinal: number;
  parameters: Record<string, unknown>;
  canonical_strategy: CanonicalStrategyV2;
  source_hash: string;
  run_id: string | null;
  created_at: string;
}

export interface ResearchExperimentRecord {
  id: string;
  revision_id: string;
  kind: "detail" | "hidden" | "robustness" | "random_baseline" | "forward";
  name: string;
  spec: Record<string, unknown>;
  candidates: ExperimentCandidateRecord[];
  created_at: string;
}

export interface DetailExperimentExecution {
  experiment: ResearchExperimentRecord;
  runs: BacktestRunRecord[];
}

export interface CreateDetailExperimentRequest {
  name: string;
  base: CatalogBaseRequest;
  dimensions: Array<{ parameter_id: string; values: unknown[] }>;
  config: BacktestConfig;
}

export interface HiddenDatasetPolicy {
  id: string;
  name: string;
  description: string;
  calibration: { start_date: string; end_date: string };
  evaluation: { start_date: string; end_date: string };
  dataset_id: string;
  initial_cash: string;
}

export interface HiddenExperimentExecution {
  experiment: ResearchExperimentRecord;
  policy: HiddenDatasetPolicy;
  calibration_run: BacktestRunRecord;
  hidden_run: BacktestRunRecord;
  generalization_gap: string | null;
}

const TAG_PREFIX = "ruletrade.catalog.v1:";

export function catalogBaseFromStrategy(strategy: CanonicalStrategyV2): CatalogBaseRequest | null {
  const tag = strategy.metadata.tags.find((item) => item.startsWith(TAG_PREFIX));
  if (!tag) return null;
  try {
    const value = JSON.parse(tag.slice(TAG_PREFIX.length)) as CatalogBaseRequest;
    return value.catalog_id && value.version === 1 && value.name ? value : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return await response.json() as T;
  const detail = await readApiErrorDetail(response, `Research request failed (${response.status})`);
  const message = typeof detail === "object" && detail && "message" in detail ? String(detail.message) : "The research test could not be completed.";
  throw new Error(message);
}

export const researchExperimentApi = {
  hiddenPolicies: (fetcher?: typeof fetch) =>
    request<{ items: HiddenDatasetPolicy[] }>("/v2/research-experiments/hidden-policies", {}, fetcher),
  createHidden: (revisionId: string, payload: { name: string; policy_id: string }, fetcher?: typeof fetch) =>
    request<HiddenExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/hidden`, jsonBody("POST", payload), fetcher),
  createDetail: (revisionId: string, payload: CreateDetailExperimentRequest, fetcher?: typeof fetch) =>
    request<DetailExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/detail`, jsonBody("POST", payload), fetcher),
  list: (revisionId: string, fetcher?: typeof fetch) =>
    request<{ items: ResearchExperimentRecord[] }>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments`, {}, fetcher),
  get: (experimentId: string, fetcher?: typeof fetch) =>
    request<ResearchExperimentRecord>(`/v2/research-experiments/${encodeURIComponent(experimentId)}`, {}, fetcher),
};
