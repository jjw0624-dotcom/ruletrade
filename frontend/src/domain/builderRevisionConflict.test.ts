import { describe, expect, it } from "vitest";
import type { CanonicalStrategyV2 } from "./canonicalV2";
import { analyzeBuilderRevisionConflict } from "./builderRevisionConflict";

const base: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2", semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Base", description: "", tags: [] }, operator_lock: {}, selection: null, predicate: null,
  definitions: { asset_sets: [{ id: "assets", assets: ["QQQ"] }], groups: [{ id: "growth", name: "Growth", asset_set_ref: "assets", description: "" }], asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" } },
  program: { semantic_id: "program", clocks: [], initial_state: {}, formalizations: [], statements: [] },
};

describe("Builder revision conflict analysis", () => {
  it("reapplies disjoint semantic addresses without replacing the remote change", () => {
    const local = structuredClone(base); local.definitions.asset_sets[0]!.assets = ["QQQ", "VGT"];
    const remote = structuredClone(base); remote.metadata.description = "Remote description";
    const result = analyzeBuilderRevisionConflict(base, local, remote);
    expect(result.classification).toBe("compatible_semantic_change");
    expect(result.merged?.metadata.description).toBe("Remote description");
    expect(result.merged?.definitions.asset_sets[0]?.assets).toEqual(["QQQ", "VGT"]);
  });

  it("blocks same-address changes and preserves both inputs for an explicit choice", () => {
    const local = structuredClone(base); local.metadata.name = "Local";
    const remote = structuredClone(base); remote.metadata.name = "Remote";
    const result = analyzeBuilderRevisionConflict(base, local, remote);
    expect(result.classification).toBe("direct_conflict");
    expect(result.conflictPaths).toContain("strategy/metadata/name");
    expect(result.merged).toBeNull();
    expect(local.metadata.name).toBe("Local");
    expect(remote.metadata.name).toBe("Remote");
  });

  it("merges independently added stable semantic identities", () => {
    const local = structuredClone(base); local.definitions.groups.push({ id: "local", name: "Local", asset_set_ref: "assets", description: "" });
    const remote = structuredClone(base); remote.definitions.groups.push({ id: "remote", name: "Remote", asset_set_ref: "assets", description: "" });
    const result = analyzeBuilderRevisionConflict(base, local, remote);
    expect(result.classification).toBe("compatible_semantic_change");
    expect(result.merged?.definitions.groups.map((group) => group.id)).toEqual(["growth", "remote", "local"]);
  });
});
