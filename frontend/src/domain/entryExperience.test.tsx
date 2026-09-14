import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreationPicker } from "../components/CreationPicker";
import { StrategyEditorProvider, createEditorState } from "../store/editorStore";
import { ExamplePreview } from "../views/ExamplePreview";
import { HomeView } from "../views/HomeView";
import { PublicView } from "../views/PublicView";
import { GuidedView } from "../views/GuidedView";
import { findExample, STRATEGY_STRUCTURES } from "./examples";
import { pathForRoute, routeFromPath } from "./navigation";
import { sleevesBootstrap } from "../test/fixture";
import { workspaceFromCreatedStrategy } from "../App";
import { AppShell } from "../components/AppShell";
import { structuralAuthoringApi } from "../structuralAuthoringApi";

const record = { id: "strategy-1", name: "Growth + Defensive", created_at: "2026-09-09T10:00:00Z", updated_at: "2026-09-10T11:00:00Z", current_revision_id: "revision-123456", archived_at: null };

describe("Product entry and starting experience", () => {
  it("keeps the root public page short and question-led", () => {
    const markup = renderToStaticMarkup(<PublicView onExample={() => undefined} onHome={() => undefined} onCreate={() => undefined} />);
    expect(markup).toContain("Test your investment ideas");
    expect(markup).toContain("What if I bought the strongest ETFs each month?");
    expect(markup).toContain("My strategies");
    expect(markup).not.toMatch(/pricing|testimonials|login/i);
  });

  it("maps every public question to a backend bootstrap id", () => {
    expect(findExample("fallback")?.question).toContain("strongest ETFs");
    expect(pathForRoute({ page: "example", exampleId: "fallback" })).toBe("/strategy/fallback");
    expect(routeFromPath("/strategy/fallback")).toEqual({ page: "example", exampleId: "fallback" });
  });

  it("previews facts projected from the real Canonical strategy", () => {
    const markup = renderToStaticMarkup(<ExamplePreview point={findExample("sleeves")!} bootstrap={sleevesBootstrap} onBack={() => undefined} onTest={() => undefined} onStart={() => undefined} />);
    expect(markup).toContain("QQQ · VGT · SOXX · SCHG");
    expect(markup).toContain("Choose the strongest 2");
    expect(markup).toContain("Otherwise use TLT");
    expect(markup).toContain("Test this strategy");
  });

  it("renders loaded, empty, and error Home states from persisted facts", () => {
    const loaded = renderToStaticMarkup(<HomeView status="loaded" strategies={[record]} error={null} onOpen={() => undefined} onRetry={() => undefined} onCreate={() => undefined} onExample={() => undefined} />);
    const empty = renderToStaticMarkup(<HomeView status="loaded" strategies={[]} error={null} onOpen={() => undefined} onRetry={() => undefined} onCreate={() => undefined} onExample={() => undefined} />);
    const error = renderToStaticMarkup(<HomeView status="error" strategies={[]} error="offline" onOpen={() => undefined} onRetry={() => undefined} onCreate={() => undefined} onExample={() => undefined} />);
    expect(loaded).toContain("Growth + Defensive"); expect(loaded).toContain("revision");
    expect(empty).toContain("What would you like to try?"); expect(empty).toContain("Build your own strategy");
    expect(error).toContain("offline"); expect(error).not.toContain("Growth + Defensive");
  });

  it("treats My strategies as its own navigable library destination", () => {
    const markup = renderToStaticMarkup(
      <AppShell
        route={{ page: "strategies" }}
        recent={[record]}
        navigate={() => undefined}
        onCreate={() => undefined}
      ><HomeView context="strategies" status="loaded" strategies={[record]} error={null} onOpen={() => undefined} onRetry={() => undefined} onCreate={() => undefined} onExample={() => undefined} /></AppShell>,
    );
    expect(markup).toContain("<strong>My strategies</strong>");
    expect(markup).toContain('<button class="active">My strategies</button>');
    expect(markup).toContain("<h1>Your strategies</h1>");
    expect(pathForRoute({ page: "strategies" })).toBe("/strategies");
  });

  it("offers examples, real structures, and an unmistakably unavailable Import", () => {
    const markup = renderToStaticMarkup(<CreationPicker onChoose={() => undefined} onClose={() => undefined} />);
    expect(STRATEGY_STRUCTURES.map((item) => item.id)).toEqual(["one_investment", "filter", "golden"]);
    expect(markup).toContain("One investment"); expect(markup).toContain("Choose assets"); expect(markup).toContain("Split a portfolio");
    expect(markup).toContain("Import strategy"); expect(markup).toContain("Coming later"); expect(markup).toContain("disabled");
  });

  it("starts structural strategies in Guide without changing Canonical", () => {
    const state = createEditorState(sleevesBootstrap, "guided");
    expect(state.editor.activeView).toBe("guided");
    expect(state.canonical).toBe(sleevesBootstrap.strategy);
    const markup = renderToStaticMarkup(<StrategyEditorProvider bootstrap={sleevesBootstrap} initialView="guided"><GuidedView /></StrategyEditorProvider>);
    expect(markup).toContain("Guided strategy editor");
  });

  it("hydrates a newly created strategy from the persisted revision immediately", async () => {
    const persisted = structuredClone(sleevesBootstrap.strategy);
    persisted.metadata.name = "Persisted response";
    const detail = {
      strategy: record,
      current_revision: {
        id: record.current_revision_id,
        strategy_id: record.id,
        parent_revision_id: null,
        canonical_strategy: persisted,
        source_hash: "hash",
        schema_version: persisted.api_version,
        created_at: record.created_at,
      },
    };
    const workspace = workspaceFromCreatedStrategy(
      detail,
      sleevesBootstrap,
      findExample("sleeves")!,
    );
    expect(workspace.detail).toBe(detail);
    expect(workspace.bootstrap.strategy).toBe(persisted);
    expect(workspace.bootstrap.strategy).not.toBe(sleevesBootstrap.strategy);
    expect(workspace.bootstrap.registry).toBe(sleevesBootstrap.registry);

    const capabilityResponse = {
      groups: [], qualification_add_targets: [], qualification_remove_targets: [],
      add_group: false, remove_group: false, rename_group: false,
      add_qualification_condition: false, remove_qualification_condition: false,
      multiple_qualification_conditions: false,
      choose_pipeline_targets: [], fallback_add_targets: [], growth_defensive_targets: [],
      create_choose_pipeline: false, add_fallback_selection: false,
      transform_to_growth_defensive: false,
    };
    const requests: string[] = [];
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(init?.body));
      return new Response(JSON.stringify(capabilityResponse), { status: 200 });
    };
    await structuralAuthoringApi.capabilities(workspace.bootstrap.strategy, fetcher);
    await structuralAuthoringApi.capabilities(detail.current_revision.canonical_strategy, fetcher);
    expect(requests).toEqual([JSON.stringify(persisted), JSON.stringify(persisted)]);
  });

  it("preserves existing Strategy, Run, and Comparison deep links", () => {
    expect(routeFromPath("/strategies")).toEqual({ page: "strategies" });
    expect(pathForRoute({ page: "strategies" })).toBe("/strategies");
    expect(routeFromPath("/strategies/a%20b")).toEqual({ page: "strategy", strategyId: "a b" });
    expect(routeFromPath("/backtest-runs/run%201")).toEqual({ page: "run", runId: "run 1" });
    expect(routeFromPath("/comparisons/c%201")).toEqual({ page: "comparison", comparisonId: "c 1" });
  });
});
