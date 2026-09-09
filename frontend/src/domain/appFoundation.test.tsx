import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { runLeanBacktest } from "../api";
import { BacktestSetup } from "../components/BacktestSetup";
import { ExploreView } from "../views/ExploreView";
import { StrategiesView } from "../views/StrategiesView";
import { STRATEGY_EXAMPLES } from "./examples";
import { pathForRoute, routeFromPath } from "./navigation";
import { createEditorState, editorReducer } from "../store/editorStore";
import { projectFlow } from "./flow";
import { projectGuided } from "./guided";
import { sleevesBootstrap } from "../test/fixture";
import { StrategyEditorProvider } from "../store/editorStore";
import { OverviewView } from "../views/OverviewView";

describe("Production MVP frontend foundation", () => {
  it("exposes only real backend-supported examples and opens a Strategy route", () => {
    const markup = renderToStaticMarkup(<ExploreView onOpen={() => undefined} onUse={() => undefined} />);
    expect(STRATEGY_EXAMPLES.map((item) => item.id)).toEqual(["sleeves", "fallback", "cooldown"]);
    expect(markup).toContain("Growth + Defensive");
    expect(routeFromPath("/strategy/sleeves")).toEqual({ page: "example", exampleId: "sleeves" });
    expect(pathForRoute({ page: "example", exampleId: "cooldown" })).toBe("/strategy/cooldown");
  });

  it("provides an empty persisted Strategies boundary", () => {
    const markup = renderToStaticMarkup(<StrategiesView status="loaded" strategies={[]} error={null} onExplore={() => undefined} onOpen={() => undefined} onRetry={() => undefined} />);
    expect(markup).toContain("No saved strategies yet");
    expect(markup).toContain("Explore examples");
  });

  it("keeps a Guided edit in the one Canonical model projected by Flow", () => {
    const initial = createEditorState(sleevesBootstrap);
    const edited = editorReducer(initial, { type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: "top_n", field: "count", value: 3 } });
    expect(projectGuided(edited.canonical, edited.registry).kind).toBe("portfolio");
    expect(projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions).nodes.find((node) => node.id === "top_n")?.data.topN).toBe(3);
  });

  it("starts shallow and projects Overview from the same Canonical strategy", () => {
    const editor = createEditorState(sleevesBootstrap);
    expect(editor.editor.activeView).toBe("overview");
    const markup = renderToStaticMarkup(<StrategyEditorProvider bootstrap={sleevesBootstrap}><OverviewView onTest={() => undefined} /></StrategyEditorProvider>);
    expect(markup).toContain("This strategy"); expect(markup).toContain("QQQ, VGT, SOXX, SCHG"); expect(markup).toContain("Quick settings"); expect(markup).toContain("Customize"); expect(markup).toContain("Test");
  });

  it("submits visible setup values while preserving the internal real dataset mapping", async () => {
    const config = STRATEGY_EXAMPLES[0].backtestDefaults;
    let submitted: unknown;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => { submitted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ strategy_hash: "sha256:test", engine: "lean", config, result: { initial_value: "100000", final_value: "101000", total_return: "0.01", total_orders: 2, total_fees: "0", equity_curve: [{ timestamp: "2024-01-01T00:00:00Z", value: "100000" }, { timestamp: "2024-12-31T00:00:00Z", value: "101000" }] } }), { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
    await runLeanBacktest(sleevesBootstrap.strategy, config, fetcher);
    expect(submitted).toEqual({ strategy: sleevesBootstrap.strategy, config });
    const setup = renderToStaticMarkup(<BacktestSetup config={config} onChange={() => undefined} onClose={() => undefined} onRun={() => undefined} />);
    expect(setup).toContain("Start date"); expect(setup).toContain("Initial investment"); expect(setup).not.toContain("filter-synthetic");
  });

  it("maps unknown paths back to Explore", () => {
    expect(routeFromPath("/compare/fake")).toEqual({ page: "explore" });
  });

  it("keeps navigation state separate from the authoritative editor state", () => {
    const editor = createEditorState(sleevesBootstrap);
    const canonical = editor.canonical;
    expect(pathForRoute({ page: "explore" })).toBe("/explore");
    expect(pathForRoute({ page: "strategies" })).toBe("/strategies");
    expect(pathForRoute({ page: "strategy", strategyId: "strategy 1" })).toBe("/strategies/strategy%201");
    expect(editor.canonical).toBe(canonical);
  });
});
