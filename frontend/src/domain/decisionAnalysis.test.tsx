import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decisionEvidenceApi, type DecisionEventDetail, type DecisionEventSummary } from "../decisionEvidenceApi";
import { AssetExplanation, Inspector, Sleeves, Snapshots } from "../components/DecisionAnalysis";
import { BacktestResultPanel } from "../components/BacktestResultPanel";
import { ResultWorkspace } from "../components/ResultWorkspace";
import { assetOutcomes, assetPath, groupDecisionSessions } from "./decisionPresentation";
import { createEditorState, editorReducer } from "../store/editorStore";
import { sleevesBootstrap } from "../test/fixture";

const source = (role: string, component_id: string) => ({ role, component_id });
function detail(ordinal: number, session_id: string, evidence: DecisionEventDetail["evidence"], refs = [source(evidence.kind, `${evidence.kind}_component`)]): DecisionEventDetail { return { id: `event-${String(ordinal).padStart(6, "0")}`, run_id: "run-1", ordinal, schema_version: 1, session_id, phase: evidence.kind === "filter" ? "evaluation" : evidence.kind === "snapshot_usage" || evidence.kind === "sleeve_contribution" || evidence.kind === "final_targets" ? "portfolio_execution" : "selection", kind: evidence.kind, source_components: refs, evidence }; }

const fallback: DecisionEventDetail[] = [
  detail(1, "2024-06-03", { kind: "filter", operator: "gt", threshold: "0", evaluations: [{ asset: "QQQ", observed: "0.243", passed: true }, { asset: "VGT", observed: "-0.067", passed: false }, { asset: "SOXX", observed: "-0.275", passed: false }] }, [source("filter", "positive_filter")]),
  detail(2, "2024-06-03", { kind: "selection", scores: { QQQ: "0.243", VGT: "-0.067", SOXX: "-0.275" }, ranked: ["QQQ"], candidates: ["QQQ"], primary_selected: [], decision: "insufficient" }, [source("rank", "rank"), source("selection", "top_n")]),
  detail(3, "2024-06-03", { kind: "fallback", asset: "TLT", activated: true }, [source("fallback", "fallback")]),
  detail(4, "2024-06-03", { kind: "final_selection", selected: ["TLT"], source: "fallback" }, [source("selection", "fallback")]),
];

const portfolio: DecisionEventDetail[] = [
  detail(5, "2024-07-01", { kind: "snapshot_usage", schedule: "quarterly", snapshots: { growth_sleeve: "2024-06-03", defensive_sleeve: "2024-01-02" }, executed: true }),
  detail(6, "2024-07-01", { kind: "sleeve_contribution", local_selected: ["TLT"], local_targets: { TLT: "1" }, allocation: "0.7", scaled_targets: { TLT: "0.7" } }, [source("sleeve", "growth_sleeve")]),
  detail(7, "2024-07-01", { kind: "sleeve_contribution", local_selected: ["TLT", "IEF"], local_targets: { TLT: "0.5", IEF: "0.5" }, allocation: "0.3", scaled_targets: { TLT: "0.15", IEF: "0.15" } }, [source("sleeve", "defensive_sleeve")]),
  detail(8, "2024-07-01", { kind: "final_targets", selected: ["TLT", "IEF"], targets: { TLT: "0.85", IEF: "0.15" } }, [source("rebalance", "rebalance")]),
];

describe("Decision Timeline and Research Inspector", () => {
  it("uses the summary endpoint first and preserves backend ordering when grouping sessions", async () => {
    const summaries = [...fallback, ...portfolio].map(({ evidence: _evidence, ...item }) => item as DecisionEventSummary);
    const fetcher = (async () => new Response(JSON.stringify({ items: summaries }), { status: 200 })) as typeof fetch;
    expect((await decisionEvidenceApi.list("run-1", fetcher)).items[0].id).toBe("event-000001");
    const groups = groupDecisionSessions(summaries);
    expect(groups.map((group) => [group.sessionId, group.label])).toEqual([["2024-06-03", "Fallback decision"], ["2024-07-01", "Portfolio rebalance"]]);
  });

  it("fetches one selected event detail through the exact API", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response(JSON.stringify(fallback[0]), { status: 200 }); }) as typeof fetch;
    expect((await decisionEvidenceApi.get("run-1", "event-000001", fetcher)).evidence.kind).toBe("filter");
    expect(calls).toEqual(["/api/v1/backtest-runs/run-1/decision-events/event-000001"]);
  });

  it("explains filter rejection and fallback without inventing the missing required count", () => {
    const markup = renderToStaticMarkup(<Inspector details={fallback} />);
    expect(markup).toContain("primary selection was incomplete"); expect(markup).toContain("TLT fallback activated"); expect(markup).toContain("Did not pass the condition"); expect(markup).toContain("Greater than 0%"); expect(markup).not.toContain("needed 2");
  });

  it("distinguishes rank cutoff from filter rejection", () => {
    const ranking = [detail(1, "2024-02-01", { kind: "filter", operator: "gt", threshold: "0", evaluations: [{ asset: "QQQ", observed: ".2", passed: true }, { asset: "VGT", observed: ".1", passed: true }, { asset: "SOXX", observed: ".05", passed: true }] }), detail(2, "2024-02-01", { kind: "selection", scores: { QQQ: ".2", VGT: ".1", SOXX: ".05" }, ranked: ["QQQ", "VGT", "SOXX"], candidates: ["QQQ", "VGT", "SOXX"], primary_selected: ["QQQ", "VGT"], decision: "executed" })];
    const markup = renderToStaticMarkup(<AssetExplanation asset="SOXX" details={ranking} />);
    expect(markup).toContain("Passed"); expect(markup).toContain("#3"); expect(markup).toContain("Not selected"); expect(markup).not.toContain("Rejected");
    expect(assetOutcomes(ranking).find((item) => item.asset === "SOXX")).toMatchObject({ kind: "ranked_out", label: "Ranked #3 · not selected" });
  });

  it("shows a scannable asset overview and an exact failed condition path", () => {
    const markup = renderToStaticMarkup(<Inspector details={fallback} />);
    expect(markup).toContain("Asset outcomes"); expect(markup).toContain("Failed qualification rule"); expect(markup).toContain("Fallback selected");
    expect(assetPath("VGT", fallback)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Qualification rule", detail: "-6.7% > 0%", status: "failed", sourceComponentId: "positive_filter" }), expect.objectContaining({ label: "Ranking", detail: "Not reached", status: "neutral" })]));
  });

  it("shows a blocked signal with elapsed and required Cooldown sessions", () => {
    const cooldown = [detail(1, "2024-04-02", { kind: "cooldown", asset: "QQQ", signal_candidate: true, last_exit: "2024-03-15", elapsed_completed_sessions: 12, required_completed_sessions: 20, eligible: false }, [source("cooldown", "cooldown")])];
    const markup = renderToStaticMarkup(<Inspector details={cooldown} />);
    expect(markup).toContain("had a signal"); expect(markup).toContain("12 of 20 completed trading sessions"); expect(markup).toContain("Blocked by waiting period");
  });

  it("reconstructs sleeve contribution math and final aggregation", () => {
    const markup = renderToStaticMarkup(<Sleeves details={portfolio} />);
    expect(markup).toContain("100% local"); expect(markup).toContain("70% sleeve"); expect(markup).toContain("70% portfolio"); expect(markup).toContain("Final TLT"); expect(markup).toContain("85%");
  });

  it("shows the exact retained snapshot dates used by a portfolio rebalance", () => {
    const markup = renderToStaticMarkup(<Snapshots details={portfolio} />);
    expect(markup).toContain("growth sleeve"); expect(markup).toContain("Jun 3, 2024"); expect(markup).toContain("defensive sleeve"); expect(markup).toContain("Jan 2, 2024");
  });

  it("keeps source focus in editor-only state", () => {
    const initial = createEditorState(sleevesBootstrap);
    const selected = editorReducer(editorReducer(initial, { type: "select_node", componentId: "positive_filter" }), { type: "set_active_view", view: "flow" });
    expect(selected.editor.selectedNodeId).toBe("positive_filter"); expect(selected.editor.activeView).toBe("flow"); expect(selected.canonical).toBe(initial.canonical);
  });

  it("connects a selected evidence date to the existing equity chart", () => {
    const result = { initial_value: "100", final_value: "110", total_return: ".1", total_orders: 2, total_fees: "1", equity_curve: [{ timestamp: "2024-06-03T00:00:00Z", value: "100" }, { timestamp: "2024-07-01T00:00:00Z", value: "110" }] };
    const sessions = groupDecisionSessions(fallback.map(({ evidence: _evidence, ...item }) => item as DecisionEventSummary));
    const markup = renderToStaticMarkup(<BacktestResultPanel result={result} selectedTimestamp="2024-06-03" decisionSessions={sessions} />);
    expect(markup).toContain("Decision selected"); expect(markup).toContain("decision-crosshair"); expect(markup).toContain("decision-marker fallback"); expect(markup).toContain('role="button"');
  });

  it("does not turn missing asset evidence into no signal", () => {
    const unknown = [detail(1, "2024-05-01", { kind: "state_mutation", asset: "QQQ", state: "last_exit", old_value: null, new_value: "2024-05-01", cause: "target_exit" })];
    expect(assetOutcomes(unknown)[0]).toMatchObject({ kind: "unknown", label: "Outcome not proven by this evidence" });
    expect(renderToStaticMarkup(<AssetExplanation asset="QQQ" details={unknown} />)).not.toContain("no signal");
  });

  it("keeps transient results honest and without a Decision Analysis request", () => {
    const response = { strategy_hash: "hash", engine: "lean" as const, config: { start_date: "2024-01-01", end_date: "2024-12-31", initial_cash: "100", dataset_id: "filter-synthetic" as const }, result: { initial_value: "100", final_value: "110", total_return: ".1", total_orders: 2, total_fees: "1", equity_curve: [{ timestamp: "2024-01-01", value: "100" }] }, timings: { source_load_ms: 0, validation_ms: 0, compiler_ms: 0, codegen_ms: 0, csharp_compile_ms: 0, lean_execution_ms: 0, result_load_ms: 0, normalization_ms: 0, total_ms: 0 } };
    const markup = renderToStaticMarkup(<ResultWorkspace response={response} strategyName="Draft" onBack={() => undefined} />);
    expect(markup).toContain("Save this strategy"); expect(markup).not.toContain("Decision timeline");
  });
});
