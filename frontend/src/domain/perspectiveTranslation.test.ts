import { describe, expect, it } from "vitest";

import type { CanonicalStrategyV2 } from "./canonicalV2";
import { translateDraftIntent } from "./draftIntents";
import { derivePerspectiveBundle, perspectivesPreserveMeaning } from "./perspectiveTranslation";

const strongest: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2", semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Strongest ETFs", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "growth-assets", assets: ["QQQ", "VGT", "SOXX", "SCHG"] }],
    groups: [{ id: "growth", name: "Investment", asset_set_ref: "growth-assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "explicit" },
  },
  operator_lock: { compare: "1", "daily.trailing_return": "1" }, selection: null, predicate: null,
  program: {
    semantic_id: "program", clocks: [{ id: "monthly-close", timeframe: "monthly", boundary: "close", timezone: "America/New_York", completed_only: true }], initial_state: {}, statements: [
      { kind: "select", semantic_id: "select-growth", output_id: "selected-growth", clock_id: "monthly-close", selection: {
        semantic_id: "growth-selection", universe_id: "growth", binding: { id: "candidate", domain_id: "growth" },
        eligibility: null, ranking: { semantic_id: "ranking", kind: "trailing_return", observations: 126, operands: [{ semantic_id: "candidate-close", kind: "observe", subject_kind: "candidate", binding_id: "candidate", field: "close", basis: "adjusted", operands: [] }] },
        direction: "descending", count: 2, shortage_policy: "require_full", fallback_asset: "TLT",
      } },
      { kind: "allocate", semantic_id: "allocate-selected", method: "equal", clock_id: "monthly-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null, legs: [{ semantic_id: "selected-leg", target: { semantic_id: "selected-target", kind: "selection", ref: "selected-growth" }, weight: null }] },
    ],
  },
};
const sleeves: CanonicalStrategyV2 = {
  ...strongest,
  metadata: { name: "Two investments", description: "", tags: [] },
  definitions: {
    ...strongest.definitions,
    asset_sets: [...strongest.definitions.asset_sets, { id: "defense-assets", assets: ["TLT", "IEF"] }],
    groups: [...strongest.definitions.groups, { id: "defense", name: "Defensive", asset_set_ref: "defense-assets", description: "" }],
  },
  program: strongest.program ? { ...strongest.program, statements: strongest.program.statements.slice(0, 1) } : null,
};

describe("perspective translation v2", () => {
  it("derives distinct Capital Flow and Decision Logic over one committed identity", () => {
    const bundle = derivePerspectiveBundle(strongest);
    expect(bundle.schemaVersion).toBe("ruletrade.dev/perspective-translation/v2");
    expect(bundle.capitalFlow.semanticIdentity).toBe(bundle.decisionLogic.semanticIdentity);
    expect(bundle.capitalFlow.nodes.map((item) => item.role)).not.toEqual(bundle.decisionLogic.blocks.map((item) => item.role));
    expect(bundle.capitalFlow.nodes.every((item) => item.sourceSemanticAddresses.length > 0)).toBe(true);
    expect(bundle.decisionLogic.blocks.every((item) => item.sourceSemanticAddresses.length > 0)).toBe(true);
  });

  it("keeps layout outside semantic identity", () => {
    const before = derivePerspectiveBundle(strongest);
    const after = derivePerspectiveBundle(JSON.parse(JSON.stringify(strongest)) as CanonicalStrategyV2);
    expect(perspectivesPreserveMeaning(before, after)).toBe(true);
    expect(before.semanticIdentity).not.toContain("flowPositions");
    expect(before.semanticIdentity).not.toContain("viewport");
  });

  it("classifies movement as layout-only", () => {
    expect(translateDraftIntent(strongest, { kind: "move_block", objectId: "statement:selection", position: { x: 1, y: 2 } })).toEqual({ status: "layout_only", semanticEffect: "none" });
    expect(translateDraftIntent(strongest, { kind: "move_flow_node", objectId: "portfolio", position: { x: 9, y: 4 } })).toEqual({ status: "layout_only", semanticEffect: "none" });
  });

  it("rejects incompatible connections without a Canonical operation", () => {
    const result = translateDraftIntent(strongest, { kind: "connect_block", childId: "value:x", childType: "value", parentId: "statement:y", inputName: "THEN" });
    expect(result.status).toBe("invalid");
    expect(result.semanticEffect).toBe("none");
    expect(result.operation).toBeUndefined();
    expect(result.diagnostic?.code).toBe("incompatible_block_connection");
  });

  it("does not confuse projection-only deletion or fallback with generic control", () => {
    const deleted = translateDraftIntent(strongest, { kind: "delete_visual_object", objectId: "selected:selection", projectionOnly: true });
    expect(deleted.status).toBe("invalid");
    expect(deleted.operation).toBeUndefined();
    const bundle = derivePerspectiveBundle(strongest);
    expect(bundle.decisionLogic.blocks.some((item) => item.role === "fallback")).toBe(true);
    expect(bundle.decisionLogic.blocks.some((item) => item.role === "control")).toBe(false);
  });

  it("translates only the registered two-investment capital route", () => {
    const result = translateDraftIntent(sleeves, {
      kind: "connect_flow", sourceId: "portfolio", targetId: `investment:${sleeves.definitions.groups[0].id}`,
      projectedEdges: [],
    });
    const hasExistingSplit = sleeves.program?.statements.some((item) => item.kind === "allocate" && item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "group").length > 1);
    if (hasExistingSplit) expect(result.status).toBe("unsupported");
    else {
      expect(result.status).toBe("ready");
      expect(result.operation?.kind).toBe("set_program_split");
    }
  });
});
