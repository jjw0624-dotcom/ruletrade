import { describe, expect, it } from "vitest";

import { momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectLogicRepresentation } from "./logicRepresentation";
import { composeTwoSleevePortfolio, insertConditionBeforeRank } from "./compositionIntents";

describe("Composer semantic intents", () => {
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
