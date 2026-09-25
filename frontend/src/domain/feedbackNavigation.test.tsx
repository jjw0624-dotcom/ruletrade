import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DecisionAnalysis } from "../components/DecisionAnalysis";
import { BacktestResultPanel } from "../components/BacktestResultPanel";
import { decisionEvidenceApi, type DecisionEventSummary } from "../decisionEvidenceApi";
import { createEditorState, editorReducer } from "../store/editorStore";
import { filterBootstrap } from "../test/fixture";
import { projectFlowCanvas, flowNodeIdForSelection } from "../views/FlowView";
import { projectConceptualFlow } from "./conceptualFlow";
import { logicStepForSelection, projectLogicRepresentation } from "./logicRepresentation";
import {
  chartResultEvents,
  filterResultEvents,
  projectResultChartSeries,
  projectResultEvents,
  resultEventsOnSeries,
  RESULT_EVENT_PAGE_SIZE,
} from "./resultEvents";
import { researchContextForMatch } from "./evidenceHarvest";
import { semanticSelection } from "./semanticSelection";

function summary(index: number, kind: DecisionEventSummary["kind"] = "selection"): DecisionEventSummary {
  const day = String((index % 28) + 1).padStart(2, "0");
  const month = String(Math.floor(index / 28) + 1).padStart(2, "0");
  return { id: `decision-${index}`, run_id: "run-daily", ordinal: index, schema_version: 2, session_id: `2025-${month}-${day}`, phase: kind === "filter" ? "evaluation" : "selection", kind, source_components: [{ role: "selection", component_id: "top_n", field_path: "config.count" }] };
}

const result = { initial_value: "100", final_value: "110", total_return: ".1", total_orders: 2, total_fees: "1", equity_curve: [{ timestamp: "2025-01-01T00:00:00Z", value: "100" }, { timestamp: "2025-06-01T00:00:00Z", value: "110" }] };

describe("Feedback Navigation and Result Events v1", () => {
  it("projects normalized series and exact persisted Run/Decision identities", () => {
    expect(projectResultChartSeries(result)).toEqual([{ time: "2025-01-01", value: 100 }, { time: "2025-06-01", value: 110 }]);
    const events = projectResultEvents("run-daily", [summary(1, "filter"), { ...summary(2, "fallback"), session_id: "2025-01-02" }]);
    expect(events[0]).toMatchObject({ runId: "run-daily", decisionId: "decision-2", decisionIds: ["decision-1", "decision-2"], category: "fallback", sessionId: "2025-01-02" });
    expect(events[0].key).toBe("run-daily:decision-2");
    expect(resultEventsOnSeries(events, projectResultChartSeries(result))).toEqual([]);
  });

  it("projects real LEAN intraday equity candlesticks as ordered unique chart dates", () => {
    const leanResult = {
      ...result,
      equity_curve: [
        { timestamp: "2024-01-02T21:00:00Z", value: "102" },
        { timestamp: "2024-01-01T05:00:00Z", value: "100" },
        { timestamp: "2024-01-02T05:00:00Z", value: "101" },
      ],
    };
    const series = projectResultChartSeries(leanResult);
    expect(series).toEqual([
      { time: "2024-01-01", value: 100 },
      { time: "2024-01-02", value: 102 },
    ]);
    expect(new Set(series.map((point) => point.time)).size).toBe(series.length);
    expect(series.every((point, index) => index === 0 || series[index - 1].time < point.time)).toBe(true);
  });

  it("keeps Daily density bounded while retaining the selected exact Decision", () => {
    const summaries = Array.from({ length: 260 }, (_, index) => summary(index + 1));
    const events = projectResultEvents("run-daily", summaries);
    const selected = events[187];
    expect(events).toHaveLength(260);
    expect(chartResultEvents(events, selected.decisionId)).toHaveLength(48);
    expect(chartResultEvents(events, selected.decisionId).some((event) => event.decisionId === selected.decisionId)).toBe(true);
    const markup = renderToStaticMarkup(<DecisionAnalysis runId="run-daily" events={events} allEventCount={events.length} listState="loaded" selected={null} onSelect={() => undefined} />);
    expect((markup.match(/data-decision-id=/g) ?? [])).toHaveLength(RESULT_EVENT_PAGE_SIZE);
    expect(markup).toContain("260 persisted");
    expect(markup).toContain("Next");
  });

  it("uses factual filters without mutating summaries or Evidence", () => {
    const summaries = [summary(1, "selection"), { ...summary(2, "fallback"), session_id: "2025-01-02" }];
    const original = structuredClone(summaries);
    const events = projectResultEvents("run-daily", summaries);
    expect(filterResultEvents(events, "fallback").map((event) => event.decisionId)).toEqual(["decision-2"]);
    expect(summaries).toEqual(original);
    const markup = renderToStaticMarkup(<BacktestResultPanel result={result} allEvents={events} events={events} filter="all" onFilter={() => undefined} />);
    expect(markup).toContain("Filter Result events");
    expect(markup).toContain("Fallback");
  });

  it("selects one persisted Decision detail with GET only and no execution or experiment request", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ ...summary(1), evidence: { kind: "selection", scores: {}, ranked: [], candidates: [], primary_selected: [], decision: "skipped", required_count: 1, asset_outcomes: [] } }), { status: 200 });
    }) as typeof fetch;
    await decisionEvidenceApi.get("run-daily", "decision-1", fetcher);
    expect(calls).toEqual([{ url: "/api/v1/backtest-runs/run-daily/decision-events/decision-1", method: undefined }]);
    expect(calls[0].url).not.toMatch(/candidates|comparisons|revisions/);
  });

  it("maps Result provenance to one address that Flow, Blocky, and Rules retain across switches", () => {
    const address = semanticSelection("rule", "positive_return", { fieldPath: "config.threshold" });
    const initial = editorReducer(createEditorState(filterBootstrap, "flow"), { type: "select_semantic", selection: address });
    const flowNodes = projectFlowCanvas(projectConceptualFlow(initial.canonical, initial.registry)).nodes;
    expect(flowNodeIdForSelection(flowNodes, address)).not.toBeNull();
    const blocky = editorReducer(initial, { type: "set_active_view", view: "blocky" });
    expect(logicStepForSelection(projectLogicRepresentation(blocky.canonical, blocky.registry), blocky.editor.selection)?.kind).toBe("condition");
    const rules = editorReducer(blocky, { type: "set_active_view", view: "rules" });
    expect(rules.editor.selection).toEqual(address);
    expect(rules.canonical).toBe(initial.canonical);
    expect(rules.validation.status).toBe("valid");
  });

  it("preserves exact Rule-to-Result Decision identity", () => {
    const context = researchContextForMatch({ runId: "run-daily", revisionId: "revision-old", sessionId: "2025-01-02", eventIds: ["decision-2"], kinds: ["fallback"], assets: ["TLT"], runCreatedAt: "", requestedPeriod: "" }, "TLT");
    expect(context).toEqual({ runId: "run-daily", sessionId: "2025-01-02", decisionId: "decision-2", asset: "TLT" });
  });
});
