import { describe, expect, it } from "vitest";

import { projectBuilderStructure } from "./builderProjection";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { projectSemanticStrategy, tryProjectSemanticStrategy } from "./semanticProjection";
import { cooldownBootstrap, sleevesBootstrap } from "../test/fixture";

function renameComponents<T extends typeof sleevesBootstrap>(bootstrap: T): T {
  const copy = structuredClone(bootstrap);
  const ids = new Map(copy.strategy.graph.components.map((component, index) => [component.id, `component-${index + 1}`]));
  for (const component of copy.strategy.graph.components) component.id = ids.get(component.id)!;
  for (const connection of copy.strategy.graph.connections) {
    connection.source.component_id = ids.get(connection.source.component_id)!;
    connection.target.component_id = ids.get(connection.target.component_id)!;
  }
  for (const entrypoint of copy.strategy.entrypoints) {
    entrypoint.event_component_id = ids.get(entrypoint.event_component_id)!;
    entrypoint.target_component_id = ids.get(entrypoint.target_component_id)!;
  }
  return copy;
}

describe("shared semantic Strategy projection", () => {
  it("derives the supported sleeve meaning without starter component ids", () => {
    const renamed = renameComponents(sleevesBootstrap);
    const semantic = projectSemanticStrategy(renamed.strategy, renamed.registry);
    const guide = projectGuided(renamed.strategy, renamed.registry);
    const flow = projectConceptualFlow(renamed.strategy, renamed.registry);
    const structure = projectBuilderStructure(flow);

    expect(semantic.groups.map((group) => [group.name, group.allocation])).toEqual([
      ["Growth", "0.70"], ["Defensive", "0.30"],
    ]);
    expect(guide.kind === "portfolio" && guide.growth.assets).toEqual(["QQQ", "VGT", "SOXX", "SCHG"]);
    expect(flow.groups.map((group) => group.label)).toEqual(["Growth", "Defensive"]);
    expect(structure.children[0].children.map((group) => group.label)).toEqual(["Growth", "Defensive"]);
    expect(JSON.stringify(flow)).not.toContain("growth_sleeve");
  });

  it("is invariant to non-semantic component array order", () => {
    const reordered = structuredClone(cooldownBootstrap);
    reordered.strategy.graph.components.reverse();
    expect(projectSemanticStrategy(reordered.strategy, reordered.registry))
      .toEqual(projectSemanticStrategy(cooldownBootstrap.strategy, cooldownBootstrap.registry));
  });

  it("keeps selection, qualification, fallback, schedule, cooldown, and provenance in one projection", () => {
    const projection = projectSemanticStrategy(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const growth = projection.groups.find((group) => group.name === "Growth")!;
    expect(growth.pipeline).toMatchObject({
      assetComponentId: "universe_assets", lookbackComponentId: "momentum",
      filterComponentId: "positive_return", rankComponentId: "momentum_rank",
      selectionComponentId: "top_n", fallbackComponentId: "fallback",
    });
    expect(projection.rebalanceScheduleComponentId).toBe("monthly");

    const cooldown = projectSemanticStrategy(cooldownBootstrap.strategy, cooldownBootstrap.registry).groups[0].pipeline;
    expect(cooldown).toMatchObject({ cooldownComponentId: "cooldown", cooldownDuration: 20, scheduleComponentId: "daily" });
  });

  it("returns an explicit unsupported result instead of choosing an arbitrary primitive", () => {
    const ambiguous = structuredClone(cooldownBootstrap);
    ambiguous.strategy.graph.components.push({
      ...structuredClone(ambiguous.strategy.graph.components.find((component) => component.primitive === "top_n@1")!),
      id: "other_selection",
    });
    ambiguous.strategy.graph.connections.push({
      source: { component_id: "momentum_rank", port: "ranked" },
      target: { component_id: "other_selection", port: "ranked" },
    }, {
      source: { component_id: "other_selection", port: "selected" },
      target: { component_id: "weights", port: "assets" },
    });
    const result = tryProjectSemanticStrategy(ambiguous.strategy, ambiguous.registry);
    expect(result).toEqual({ supported: false, reason: "Expected one top_n@1 component, found 2" });
    expect(projectConceptualFlow(ambiguous.strategy, ambiguous.registry)).toMatchObject({ groups: [], unsupportedReason: result.supported ? undefined : result.reason });
  });
});
