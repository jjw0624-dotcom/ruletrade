import type { DecisionEventDetail } from "./decisionEvidenceApi";
import { readApiErrorDetail } from "./apiError";

export type BehaviorDifferenceKind = "event_presence_changed" | "qualification_changed" | "rank_changed" | "candidate_membership_changed" | "primary_selection_changed" | "fallback_activation_changed" | "cooldown_eligibility_changed" | "final_selection_changed" | "snapshot_targets_changed" | "snapshot_usage_changed" | "sleeve_contribution_changed" | "state_mutation_changed" | "final_target_changed";
export interface BehaviorDifference { key: string; presence: "both" | "original_only" | "candidate_only"; kinds: BehaviorDifferenceKind[]; original_event: DecisionEventDetail | null; candidate_event: DecisionEventDetail | null }
export interface DecisionContextDiff { session_id: string; differences: BehaviorDifference[] }
export interface MetricDiff<T> { original: T; candidate: T; delta: T }
export interface ComparisonRecord {
  schema_version: 1;
  id: string;
  candidate_id: string;
  original_run_id: string;
  candidate_run_id: string;
  strategy_diff: { component_id: string; field_path: string; before: string; after: string };
  aligned_evidence_records: number;
  changed_decision_contexts: DecisionContextDiff[];
  first_difference: { session_id: string; difference_key: string } | null;
  result_diff: { initial_value: MetricDiff<string>; final_value: MetricDiff<string>; total_return: MetricDiff<string>; total_orders: MetricDiff<number>; total_fees: MetricDiff<string>; original_equity_run_id: string; candidate_equity_run_id: string };
  compute_ms: number;
  created_at: string;
}
export class ComparisonApiError extends Error { constructor(public status: number, public detail: { code: string; message: string }) { super(detail.message); } }
async function request<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, init);
  if (response.ok) return response.json() as Promise<T>;
  const detail = await readApiErrorDetail(response, `Comparison request failed (${response.status})`);
  throw new ComparisonApiError(response.status, detail);
}
export const comparisonApi = {
  create: (candidateId: string, fetcher?: typeof fetch) => request<ComparisonRecord>(`/v1/candidates/${encodeURIComponent(candidateId)}/comparison`, { method: "POST" }, fetcher),
  get: (comparisonId: string, fetcher?: typeof fetch) => request<ComparisonRecord>(`/v1/comparisons/${encodeURIComponent(comparisonId)}`, {}, fetcher),
};
