import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runLeanBacktest } from "../api";
import { BacktestErrorPanel } from "../components/BacktestErrorPanel";
import { BacktestResultPanel } from "../components/BacktestResultPanel";
import type { LeanBacktestResponse } from "./backtest";
import { createEditorState, editorReducer, canStartBacktest } from "../store/editorStore";
import { goldenBootstrap } from "../test/fixture";


const response: LeanBacktestResponse = {
  strategy_hash: "sha256:edited",
  engine: "lean",
  config: {
    start_date: "2024-01-01",
    end_date: "2024-12-31",
    initial_cash: "100000",
    dataset_id: "golden-synthetic",
  },
  result: {
    initial_value: "100000",
    final_value: "133448.49",
    total_return: "0.33448",
    total_orders: 51,
    total_fees: "73.86",
    equity_curve: [
      { timestamp: "2024-01-02T00:00:00Z", value: "100000" },
      { timestamp: "2024-12-31T00:00:00Z", value: "133448.49" },
    ],
  },
};


describe("Editor-to-LEAN backtest architecture", () => {
  it("submits the exact current Canonical after a Guided semantic edit", async () => {
    const initial = createEditorState(goldenBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "count", value: 3 },
    });
    let submitted: unknown;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await runLeanBacktest(edited.canonical, undefined, fetcher);

    const body = submitted as { strategy: typeof edited.canonical };
    expect(body.strategy).toEqual(edited.canonical);
    expect(body.strategy.graph.components.find((item) => item.id === "growth_random")?.config.count).toBe(3);
    expect(body.strategy).not.toEqual(initial.canonical);
  });

  it("prevents another run while one is already running", () => {
    const initial = createEditorState(goldenBootstrap);
    const running = editorReducer(initial, { type: "backtest_started" });

    expect(canStartBacktest(running)).toBe(false);
    expect(editorReducer(running, { type: "backtest_started" })).toBe(running);
  });

  it("renders normalized result metrics and an equity curve", () => {
    const markup = renderToStaticMarkup(<BacktestResultPanel result={response.result} />);

    expect(markup).toContain("$133,448.49");
    expect(markup).toContain("33.45%");
    expect(markup).toContain(">51<");
    expect(markup).toContain("$73.86");
    expect(markup).toContain("Portfolio value equity curve");
  });

  it("renders a useful structured error", () => {
    const markup = renderToStaticMarkup(
      <BacktestErrorPanel error={{ code: "runtime_unavailable", message: "Docker runtime is unavailable." }} />,
    );

    expect(markup).toContain("Backtest could not run");
    expect(markup).toContain("Docker runtime is unavailable.");
    expect(markup).toContain("runtime_unavailable");
  });

  it("does not mutate Canonical and editing still works after success", () => {
    const initial = createEditorState(goldenBootstrap);
    const canonicalBefore = initial.canonical;
    const completed = editorReducer(
      editorReducer(initial, { type: "backtest_started" }),
      { type: "backtest_succeeded", result: response },
    );
    const edited = editorReducer(completed, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "count", value: 3 },
    });

    expect(completed.canonical).toBe(canonicalBefore);
    expect(edited.canonical.graph.components.find((item) => item.id === "growth_random")?.config.count).toBe(3);
    expect(edited.backtest.status).toBe("success");
  });
});
