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

export interface RobustnessPolicy {
  id: string;
  name: string;
  description: string;
  start_date_offsets: number[];
}

export interface TestExperimentExecution {
  experiment: ResearchExperimentRecord;
  runs: BacktestRunRecord[];
}

export interface HiddenExperimentExecution {
  experiment: ResearchExperimentRecord;
  policy: HiddenDatasetPolicy;
  calibration_run: BacktestRunRecord;
  hidden_run: BacktestRunRecord;
  generalization_gap: string | null;
}

export interface ForwardExperimentExecution {
  experiment: ResearchExperimentRecord;
  latest_run: BacktestRunRecord;
}

export interface CreateForwardExperimentRequest {
  name: string;
  start_date: string;
  initial_cash: string;
  dataset_id: string;
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
  robustnessPolicies: (fetcher?: typeof fetch) =>
    request<{ items: RobustnessPolicy[] }>("/v2/research-experiments/robustness-policies", {}, fetcher),
  createRobustness: (revisionId: string, payload: { name: string; policy_id: string; config: BacktestConfig }, fetcher?: typeof fetch) =>
    request<TestExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/robustness`, jsonBody("POST", payload), fetcher),
  createRandomBaseline: (revisionId: string, payload: { name: string; base: CatalogBaseRequest; seeds: number[]; config: BacktestConfig }, fetcher?: typeof fetch) =>
    request<TestExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/random-baseline`, jsonBody("POST", payload), fetcher),
  hiddenPolicies: (fetcher?: typeof fetch) =>
    request<{ items: HiddenDatasetPolicy[] }>("/v2/research-experiments/hidden-policies", {}, fetcher),
  createHidden: (revisionId: string, payload: { name: string; policy_id: string }, fetcher?: typeof fetch) =>
    request<HiddenExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/hidden`, jsonBody("POST", payload), fetcher),
  createDetail: (revisionId: string, payload: CreateDetailExperimentRequest, fetcher?: typeof fetch) =>
    request<DetailExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/detail`, jsonBody("POST", payload), fetcher),
  createForward: (revisionId: string, payload: CreateForwardExperimentRequest, fetcher?: typeof fetch) =>
    request<ForwardExperimentExecution>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments/forward`, jsonBody("POST", payload), fetcher),
  refreshForward: (experimentId: string, fetcher?: typeof fetch) =>
    request<ForwardExperimentExecution>(`/v2/research-experiments/${encodeURIComponent(experimentId)}/forward/refresh`, jsonBody("POST", {}), fetcher),
  list: (revisionId: string, fetcher?: typeof fetch) =>
    request<{ items: ResearchExperimentRecord[] }>(`/v2/revisions/${encodeURIComponent(revisionId)}/research-experiments`, {}, fetcher),
  get: (experimentId: string, fetcher?: typeof fetch) =>
    request<ResearchExperimentRecord>(`/v2/research-experiments/${encodeURIComponent(experimentId)}`, {}, fetcher),
};
