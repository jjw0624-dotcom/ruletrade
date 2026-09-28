import { describe, expect, it } from "vitest";

import { momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectLogicRepresentation } from "./logicRepresentation";
import type { CanonicalStrategyV1 } from "./canonical";
import { composeRankedSelectionPipeline, composeTwoSleevePortfolio, insertConditionBeforeRank } from "./compositionIntents";

const oneInvestment = {
  metadata: { name: "One investment", description: "" },
  definitions: { asset_sets: [{ id: "investment", assets: ["QQQ"] }] },
  graph: {
    components: [
      { id: "monthly", primitive: "monthly@1", config: { day: 1 } },
      { id: "investment_assets", primitive: "asset_set@1", config: { asset_set_ref: "investment" } },
      { id: "weights", primitive: "equal_weight@1", config: { total: "1" } },
      { id: "rebalance", primitive: "rebalance@1", config: {} },
    ],
    connections: [
      { source: { component_id: "investment_assets", port: "assets" }, target: { component_id: "weights", port: "assets" } },
      { source: { component_id: "weights", port: "targets" }, target: { component_id: "rebalance", port: "targets" } },
    ],
  },
  entrypoints: [{ event_component_id: "monthly", target_component_id: "rebalance" }],
} as CanonicalStrategyV1;

describe("Composer semantic intents", () => {
  it("creates the minimum valid Metric, Rank, and Choose scaffold through typed generic mutations", () => {
    const operation = composeRankedSelectionPipeline(oneInvestment, "weights", 126, 2);
    expect(operation?.mutations).toEqual([
      { kind: "disconnect", source: { component_id: "investment_assets", port: "assets" }, target: { component_id: "weights", port: "assets" } },
      { kind: "create_component", ref: "metric", primitive: "trailing_return@1", config: { lookback_bars: 126 } },
      { kind: "create_component", ref: "rank", primitive: "rank@1", config: { direction: "descending" } },
      { kind: "create_component", ref: "choose", primitive: "top_n@1", config: { count: 2 } },
      { kind: "connect", source: { component_id: "investment_assets", port: "assets" }, target: { created_ref: "metric", port: "assets" } },
      { kind: "connect", source: { created_ref: "metric", port: "scores" }, target: { created_ref: "rank", port: "scores" } },
      { kind: "connect", source: { created_ref: "rank", port: "ranked" }, target: { created_ref: "choose", port: "ranked" } },
      { kind: "connect", source: { created_ref: "choose", port: "selected" }, target: { component_id: "weights", port: "assets" } },
    ]);
  });

  it("refuses to guess the Metric insertion edge", () => {
    const ambiguous = structuredClone(oneInvestment);
    ambiguous.graph.connections.push({ source: { component_id: "investment_assets", port: "assets" }, target: { component_id: "weights", port: "assets" } });
    expect(composeRankedSelectionPipeline(ambiguous, "weights", 126, 1)).toBeNull();
  });

  it("describes an exact atomic score-pipeline splice", () => {
    const operation = insertConditionBeforeRank(momentumBootstrap.strategy, "momentum_rank");
    expect(operation).toEqual({ kind: "compose_strategy", mutations: [
      { kind: "disconnect", source: { component_id: "momentum", port: "scores" }, target: { component_id: "momentum_rank", port: "scores" } },
      { kind: "create_component", ref: "condition", primitive: "filter@1", config: { operator: "gt", threshold: "0" } },
      { kind: "connect", source: { component_id: "momentum", port: "scores" }, target: { created_ref: "condition", port: "scores" } },
      { kind: "connect", source: { created_ref: "condition", port: "scores" }, target: { component_id: "momentum_rank", port: "scores" } },
    ] });
  });

  it("refuses to guess when a splice target is ambiguous", () => {
    const canonical = structuredClone(momentumBootstrap.strategy);
    canonical.graph.connections.push({ source: { component_id: "momentum", port: "scores" }, target: { component_id: "momentum_rank", port: "scores" } });
    expect(insertConditionBeforeRank(canonical, "momentum_rank")).toBeNull();
  });

  it("builds a two-sleeve batch from request-local refs and the exact existing effect edge", () => {
    const operation = composeTwoSleevePortfolio(momentumBootstrap.strategy, "weights", "0.7", ["TLT"]);
    expect(operation?.mutations[0]).toEqual({ kind: "disconnect", source: { component_id: "weights", port: "targets" }, target: { component_id: "rebalance", port: "targets" } });
    expect(operation?.mutations.some((item) => item.kind === "create_component" && item.primitive === "portfolio@1")).toBe(true);
    expect(JSON.stringify(operation)).not.toContain("_portfolio");
  });

  it("projects an authoritative sleeves shape coherently in Flow and Blocky", () => {
    const flow = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const logic = projectLogicRepresentation(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    expect(flow.groups).toHaveLength(2);
    expect(flow.split?.groups).toHaveLength(2);
    expect(logic.groups.map((group) => group.id)).toEqual(expect.arrayContaining(["growth_sleeve", "defensive_sleeve"]));
  });
});
