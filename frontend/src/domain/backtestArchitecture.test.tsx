import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runLeanBacktest } from "../api";
import { BacktestErrorPanel } from "../components/BacktestErrorPanel";
import { BacktestResultPanel } from "../components/BacktestResultPanel";
import { backtestReducer, INITIAL_BACKTEST_STATUS, type LeanBacktestResponse } from "./backtest";
import { createEditorState, editorReducer } from "../store/editorStore";
import { goldenBootstrap } from "../test/fixture";
import { authoringResponse } from "../test/authoringResponse";


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
  timings: { source_load_ms: 0, validation_ms: 1, compiler_ms: 2, codegen_ms: 3, csharp_compile_ms: 4, lean_execution_ms: 5, result_load_ms: 1, normalization_ms: 1, total_ms: 17 },
};


describe("Editor-to-LEAN backtest architecture", () => {
  it("submits the exact current Canonical after a Guided semantic edit", async () => {
    const initial = createEditorState(goldenBootstrap);
    const edited = editorReducer(initial, { type: "replace_canonical_dirty", canonical: authoringResponse(initial.canonical, "growth_random", { count: 3 }) });
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
    const running = backtestReducer(INITIAL_BACKTEST_STATUS, { type: "started" });
    expect(running.status).toBe("running");
    expect(backtestReducer(running, { type: "started" })).toBe(running);
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

    expect(markup).toContain("backtest service is unavailable");
    expect(markup).toContain("Docker runtime is unavailable.");
    expect(markup).toContain("runtime_unavailable");
  });

  it("keeps backtest results separate from Canonical editor state", () => {
    const initial = createEditorState(goldenBootstrap);
    const canonicalBefore = initial.canonical;
    const completed = backtestReducer(backtestReducer(INITIAL_BACKTEST_STATUS, { type: "started" }), { type: "succeeded", result: response });
    const edited = editorReducer(initial, { type: "replace_canonical_dirty", canonical: authoringResponse(initial.canonical, "growth_random", { count: 3 }) });

    expect(initial.canonical).toBe(canonicalBefore);
    expect(completed.status).toBe("success");
    expect(edited.canonical.graph.components.find((item) => item.id === "growth_random")?.config.count).toBe(3);
  });
});
