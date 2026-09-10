export interface SourceComponentRef { role: string; component_id: string; field_path?: string | null }
export interface AssetPredicate { asset: string; observed: string; passed: boolean }
export interface AssetPredicateV2 extends AssetPredicate { stopping_stage: "filter" | null }
export interface SelectionAssetOutcome {
  asset: string;
  evaluated: true;
  signal: "present" | "absent";
  rank: number;
  primary_selected: boolean;
  stopping_stage: "rank_cutoff" | "primary_selection_incomplete" | "fallback_replacement" | null;
}
export type DecisionPhase = "evaluation" | "selection" | "snapshot_commit" | "portfolio_execution" | "state_mutation";

type SharedDecisionEvidence =
  | { kind: "fallback"; asset: string; activated: boolean }
  | { kind: "final_selection"; selected: string[]; source: "primary" | "fallback" }
  | { kind: "state_mutation"; asset: string; state: "last_exit"; old_value: string | null; new_value: string; cause: "target_exit" }
  | { kind: "snapshot_refresh"; schedule: "monthly" | "quarterly"; local_targets: Record<string, string>; snapshot_session: string }
  | { kind: "snapshot_usage"; schedule: "monthly" | "quarterly"; snapshots: Record<string, string>; executed: boolean }
  | { kind: "sleeve_contribution"; local_selected: string[]; local_targets: Record<string, string>; allocation: string; scaled_targets: Record<string, string> }
  | { kind: "final_targets"; selected: string[]; targets: Record<string, string> };

export type DecisionEvidenceV1 = SharedDecisionEvidence
  | { kind: "filter"; operator: "gt"; threshold: string; evaluations: AssetPredicate[] }
  | { kind: "selection"; scores: Record<string, string>; ranked: string[]; candidates: string[]; primary_selected: string[]; decision: "executed" | "insufficient" | "skipped" | "signal" }
  | { kind: "random_selection"; universe: string[]; selected: string[]; resample: "once" | "per_event" }
  | { kind: "cooldown"; asset: string; signal_candidate: boolean; last_exit: string | null; elapsed_completed_sessions: number | null; required_completed_sessions: number; eligible: boolean };

export type DecisionEvidenceV2 = SharedDecisionEvidence
  | { kind: "filter"; operator: "gt"; threshold: string; evaluations: AssetPredicateV2[]; decision_universe: string[] }
  | { kind: "selection"; scores: Record<string, string>; ranked: string[]; candidates: string[]; primary_selected: string[]; decision: "executed" | "insufficient" | "skipped" | "signal"; required_count: number; asset_outcomes: SelectionAssetOutcome[] }
  | { kind: "random_selection"; universe: string[]; selected: string[]; resample: "once" | "per_event"; required_count: number }
  | { kind: "cooldown"; asset: string; signal_candidate: boolean; last_exit: string | null; elapsed_completed_sessions: number | null; required_completed_sessions: number; eligible: boolean; stopping_stage: "cooldown" | null };

export type DecisionEvidence = DecisionEvidenceV1 | DecisionEvidenceV2;
interface DecisionEventBase { id: string; run_id: string; ordinal: number; session_id: string; phase: DecisionPhase; kind: DecisionEvidence["kind"]; source_components: SourceComponentRef[] }
export type DecisionEventSummary = DecisionEventBase & ({ schema_version: 1 } | { schema_version: 2 });
export type DecisionEventDetail =
  | (DecisionEventBase & { schema_version: 1; evidence: DecisionEvidenceV1 })
  | (DecisionEventBase & { schema_version: 2; evidence: DecisionEvidenceV2 });

export class DecisionEvidenceApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

async function request<T>(path: string, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`);
  if (response.ok) return (await response.json()) as T;
  let detail: { code?: string; message?: string } = {};
  try { detail = ((await response.json()) as { detail?: typeof detail }).detail ?? {}; } catch { /* unavailable or malformed response */ }
  throw new DecisionEvidenceApiError(response.status, detail.code ?? "request_failed", detail.message ?? `Decision evidence request failed (${response.status})`);
}

export const decisionEvidenceApi = {
  list: (runId: string, fetcher?: typeof fetch) => request<{ items: DecisionEventSummary[] }>(`/v1/backtest-runs/${encodeURIComponent(runId)}/decision-events`, fetcher),
  get: (runId: string, eventId: string, fetcher?: typeof fetch) => request<DecisionEventDetail>(`/v1/backtest-runs/${encodeURIComponent(runId)}/decision-events/${encodeURIComponent(eventId)}`, fetcher),
};
