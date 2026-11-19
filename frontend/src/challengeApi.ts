import { jsonBody, readApiErrorDetail } from "./apiError";
import type { BacktestConfig } from "./domain/backtest";
import type { BacktestRunRecord } from "./backtestRunApi";

export interface ChallengeObjective {
  metric: "total_return";
  direction: "maximize" | "minimize";
}
export interface ChallengeDefinition {
  id: string;
  version: number;
  kind: "learning" | "competition";
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  policy: {
    version: number;
    config: BacktestConfig;
    objective: ChallengeObjective;
    constraints: {
      allowed_catalog_ids: string[];
      allowed_assets: string[];
      required_parameters: Record<string, unknown>;
      max_total_orders: number | null;
    };
  };
}
export interface ChallengeSubmissionRecord {
  id: string;
  challenge_id: string;
  challenge_version: number;
  policy_version: number;
  revision_id: string;
  run_id: string;
  catalog_id: string | null;
  catalog_parameters: Record<string, unknown>;
  eligible: boolean;
  violations: string[];
  score: string | null;
  objective: ChallengeObjective;
  created_at: string;
}
export interface ChallengeSubmissionExecution {
  submission: ChallengeSubmissionRecord;
  run: BacktestRunRecord;
}

async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return await response.json() as T;
  const detail = await readApiErrorDetail(response, `Challenge request failed (${response.status})`);
  const message = typeof detail === "object" && detail && "message" in detail
    ? String(detail.message)
    : "The challenge request could not be completed.";
  throw new Error(message);
}

export const challengeApi = {
  list: (fetcher?: typeof fetch) =>
    request<{ items: ChallengeDefinition[] }>("/v2/challenges", {}, fetcher),
  submissions: (challengeId: string, fetcher?: typeof fetch) =>
    request<{ items: ChallengeSubmissionRecord[] }>(
      `/v2/challenges/${encodeURIComponent(challengeId)}/submissions`, {}, fetcher,
    ),
  submit: (challengeId: string, revisionId: string, fetcher?: typeof fetch) =>
    request<ChallengeSubmissionExecution>(
      `/v2/challenges/${encodeURIComponent(challengeId)}/submissions`,
      jsonBody("POST", { revision_id: revisionId }),
      fetcher,
    ),
};
