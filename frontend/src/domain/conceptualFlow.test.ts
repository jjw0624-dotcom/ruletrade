import { describe, expect, it } from "vitest";
import { conceptualOnlyAllocationExample, projectConceptualFlow } from "./conceptualFlow";
import { cooldownBootstrap, fallbackBootstrap, filterBootstrap, goldenBootstrap, independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";

describe("Conceptual Flow v2 projection", () => {
  it.each([
    ["golden", goldenBootstrap],
    ["momentum", momentumBootstrap],
    ["filter", filterBootstrap],
    ["fallback", fallbackBootstrap],
    ["sleeves", sleevesBootstrap],
    ["independent schedules", independentSchedulesBootstrap],
    ["cooldown", cooldownBootstrap],
  ])("projects %s deterministically without changing Canonical", (_name, bootstrap) => {
    const before = JSON.stringify(bootstrap.strategy);
    const first = projectConceptualFlow(bootstrap.strategy, bootstrap.registry);
    const second = projectConceptualFlow(bootstrap.strategy, bootstrap.registry);
    expect(first).toEqual(second);
    expect(JSON.stringify(bootstrap.strategy)).toBe(before);
    expect(first.groups.length).toBeGreaterThan(0);
    expect(first.sourceComponentIds.length).toBeGreaterThan(0);
  });

  it("compresses selection primitives into one Choose while retaining provenance", () => {
    const flow = projectConceptualFlow(fallbackBootstrap.strategy, fallbackBootstrap.registry);
    const choose = flow.groups[0].choose!;
    expect(choose.label).toBe("Choose 2");
    expect(choose.condition).toBe("6M return > 0%");
    expect(choose.ranking).toBe("Weakest first");
    expect(choose.otherwise).toBe("Otherwise → TLT");
    expect(choose.sourceComponentIds).toEqual(expect.arrayContaining(["momentum", "positive_return", "top_n", "fallback"]));
  });

  it("projects sleeve hierarchy, split, and independent timing as properties", () => {
    const flow = projectConceptualFlow(independentSchedulesBootstrap.strategy, independentSchedulesBootstrap.registry);
    expect(flow.kind).toBe("portfolio");
    expect(flow.groups.map((group) => [group.label, group.allocation])).toEqual([["Growth", "70%"], ["Defensive", "30%"]]);
    expect(flow.groups[0].timing).toBe("Monthly");
    expect(flow.groups[1].timing).toBe("Quarterly");
    expect(flow.rebalance).toBe("Quarterly");
  });

  it("keeps Cooldown inside Choose intent", () => {
    const flow = projectConceptualFlow(cooldownBootstrap.strategy, cooldownBootstrap.registry);
    expect(flow.groups[0].choose?.cooldown).toContain("trading days");
    expect(flow.groups[0].choose?.sourceComponentIds).toContain("cooldown");
  });

  it("marks unsupported conditional allocation instead of fabricating execution", () => {
    expect(conceptualOnlyAllocationExample.supported).toBe(false);
    expect(conceptualOnlyAllocationExample.reason).toContain("do not express");
  });
});

