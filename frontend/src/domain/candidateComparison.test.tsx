import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { candidateApi } from "../candidateApi";
import { comparisonApi, type ComparisonRecord, type DecisionContextDiff } from "../comparisonApi";
import { Inspector } from "../components/DecisionAnalysis";
import { selectInitialDifference } from "../components/ComparisonWorkspace";
import type { DecisionEventDetail } from "../decisionEvidenceApi";
import { pathForRoute, routeFromPath } from "./navigation";

const filter = (passed = false): DecisionEventDetail => ({ id: "filter-event", run_id: "run-original", ordinal: 1, schema_version: 2, session_id: "2024-06-03", phase: "evaluation", kind: "filter", source_components: [{ role: "filter", component_id: "positive_return", field_path: "config.threshold" }], evidence: { kind: "filter", operator: "gt", threshold: "0", decision_universe: ["VGT"], evaluations: [{ asset: "VGT", observed: "-0.032", passed, stopping_stage: passed ? null : "filter" }] } });
const comparison = (contexts: ComparisonRecord["changed_decision_contexts"]): ComparisonRecord => ({ schema_version: 1, id: "comparison-1", candidate_id: "candidate-1", original_run_id: "run-original", candidate_run_id: "run-candidate", strategy_diff: { component_id: "positive_return", field_path: "config.threshold", before: "0", after: "-0.05" }, aligned_evidence_records: 8, changed_decision_contexts: contexts, first_difference: contexts[0] ? { session_id: contexts[0].session_id, difference_key: contexts[0].differences[0].key } : null, result_diff: { initial_value: { original: "10000", candidate: "10000", delta: "0" }, final_value: { original: "13740", candidate: "14100", delta: "360" }, total_return: { original: ".374", candidate: ".41", delta: ".036" }, total_orders: { original: 12, candidate: 15, delta: 3 }, total_fees: { original: "12", candidate: "15", delta: "3" }, original_equity_run_id: "run-original", candidate_equity_run_id: "run-candidate" }, compute_ms: 8, created_at: "2026-09-10T00:00:00Z" });

describe("Candidate and Comparison research loop", () => {
  it("shows Candidate affordance only for an evidence-v2 filter threshold with exact provenance", () => {
    const eligible = renderToStaticMarkup(<Inspector details={[filter()]} onTryChange={() => undefined} />);
    expect(eligible).toContain("Try changing 0%");
    const unsupported = { ...filter(), source_components: [{ role: "filter", component_id: "positive_return", field_path: "config.operator" }] } as DecisionEventDetail;
    expect(renderToStaticMarkup(<Inspector details={[unsupported]} onTryChange={() => undefined} />)).not.toContain("Try changing");
  });

  it("sends the backend-owned minimal semantic Candidate intent without Canonical JSON", async () => {
    let path = ""; let body: unknown;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { path = String(input); body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ candidate: { id: "candidate-1" }, run: { status: "succeeded" } }), { status: 201 }); }) as typeof fetch;
    await candidateApi.create("run-original", { kind: "filter_threshold", component_id: "positive_return", field_path: "config.threshold", expected_before: "0", proposed_after: "-0.05" }, "filter-event", fetcher);
    expect(path).toBe("/api/v1/backtest-runs/run-original/candidates");
    expect(body).toEqual({ change: { kind: "filter_threshold", component_id: "positive_return", field_path: "config.threshold", expected_before: "0", proposed_after: "-0.05" }, originating_decision_event_id: "filter-event" });
    expect(JSON.stringify(body)).not.toContain("canonical_strategy");
  });

  it("creates and reloads the immutable backend Comparison through exact routes", async () => {
    const calls: Array<[string,string | undefined]> = [];
    const payload = comparison([]);
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push([String(input), init?.method]); return new Response(JSON.stringify(payload), { status: 200 }); }) as typeof fetch;
    await comparisonApi.create("candidate-1", fetcher); await comparisonApi.get("comparison-1", fetcher);
    expect(calls).toEqual([["/api/v1/candidates/candidate-1/comparison", "POST"], ["/api/v1/comparisons/comparison-1", undefined]]);
    expect(routeFromPath("/comparisons/comparison-1")).toEqual({ page: "comparison", comparisonId: "comparison-1" });
    expect(pathForRoute({ page: "comparison", comparisonId: "comparison 1" })).toBe("/comparisons/comparison%201");
  });

  it("keeps backend chronological alignment and restores the originating asset when it changed", () => {
    const before = filter(false); const after = filter(true);
    const fallbackEvent: DecisionEventDetail = { id: "fallback", run_id: "run-original", ordinal: 2, schema_version: 2, session_id: "2024-07-01", phase: "selection", kind: "fallback", source_components: [{ role: "fallback", component_id: "fallback" }], evidence: { kind: "fallback", asset: "TLT", activated: true } };
    const contexts: DecisionContextDiff[] = [{ session_id: "2024-06-03", differences: [{ key: "qualification", presence: "both", kinds: ["qualification_changed"], original_event: before, candidate_event: after }] }, { session_id: "2024-07-01", differences: [{ key: "fallback", presence: "original_only", kinds: ["event_presence_changed", "fallback_activation_changed"], original_event: fallbackEvent, candidate_event: null }] }];
    const selected = selectInitialDifference(comparison(contexts), { runId: "run-original", sessionId: "2024-06-03", asset: "VGT" });
    expect(selected?.context.session_id).toBe("2024-06-03"); expect(selected?.difference.key).toBe("qualification");
    expect(comparison(contexts).changed_decision_contexts.map((item) => item.session_id)).toEqual(["2024-06-03", "2024-07-01"]);
  });

  it("treats zero changed decisions as a valid Comparison payload", () => {
    const payload = comparison([]);
    expect(payload.strategy_diff.before).not.toBe(payload.strategy_diff.after);
    expect(payload.changed_decision_contexts).toHaveLength(0);
  });
});
