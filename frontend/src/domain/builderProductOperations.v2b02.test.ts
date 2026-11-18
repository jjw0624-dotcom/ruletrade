import { describe, expect, it } from "vitest";
import type { CanonicalStrategyV2, ProgramStatementV2 } from "./canonicalV2";
import { adaptV2ProductOperation } from "./builderProductOperations";

const selection: Extract<ProgramStatementV2, { kind: "select" }> = {
  kind: "select",
  semantic_id: "blocky-select-draft-start",
  output_id: "blocky-subgroup-draft-start",
  clock_id: null,
  selection: {
    semantic_id: "blocky-selection-draft-start",
    universe_id: "group-1",
    binding: { id: "blocky-binding-draft-start", domain_id: "group-1" },
    eligibility: null,
    ranking: {
      semantic_id: "ranking",
      kind: "trailing_return",
      operands: [{
        semantic_id: "close",
        kind: "observe",
        operands: [],
        subject_kind: "candidate",
        subject_id: null,
        binding_id: "blocky-binding-draft-start",
        field: "close",
        basis: "adjusted",
        skip: 0,
        missing_policy: "require_all",
        minimum_count: 1,
        minimum_fraction: 1,
      }],
      observations: 63,
      skip: 0,
      missing_policy: "require_all",
      minimum_count: 1,
      minimum_fraction: 1,
    },
    direction: "descending",
    count: 1,
    shortage_policy: "choose_all",
    fallback_asset: null,
  },
};

const buy: Extract<ProgramStatementV2, { kind: "buy" }> = {
  kind: "buy",
  semantic_id: "blocky-buy-draft-start",
  target: { semantic_id: "blocky-buy-target-draft-start", kind: "selection", ref: selection.output_id },
  amount: { kind: "units_each", units: 1 },
  clock_id: null,
};

const strategy: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "V2B-02", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "group-1-assets", assets: ["QQQ", "VOO"] }],
    groups: [{ id: "group-1", name: "Group 1", asset_set_ref: "group-1-assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "group-1-assets", coordinate_policy: "member_identity" },
  },
  operator_lock: {},
  selection: null,
  predicate: null,
  program: {
    semantic_id: "program",
    clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "America/New_York", completed_only: true }],
    initial_state: {},
    statements: [{
      kind: "on_event",
      semantic_id: "blocky-event-draft-start",
      event: {
        semantic_id: "blocky-event-definition-draft-start",
        clock_id: "daily-close",
        condition: null,
        trigger: "scheduled",
        occurrence: "every",
        ordinal: null,
      },
      statements: [selection, buy],
    }],
  },
};

describe("V2B-02 nested selection product operations", () => {
  it("edits Filter eligibility inside the Blocky event without losing its semantic address", () => {
    expect(adaptV2ProductOperation(strategy, {
      kind: "setQualification",
      lookback: 126,
      operator: "gt",
      threshold: 0,
    }, { selectionId: selection.semantic_id })).toMatchObject([{
      kind: "set_program_condition",
      semantic_id: selection.semantic_id,
      role: "selection_eligibility",
      condition: {
        kind: "comparison",
        operator: "gt",
        left: { kind: "trailing_return", observations: 126 },
        right: { value: 0, unit: "ratio" },
      },
    }]);
  });

  it("edits Top N inside the Blocky event while preserving Filter, Group, and Buy identity", () => {
    const [operation] = adaptV2ProductOperation(strategy, {
      kind: "setSelection",
      lookback: 84,
      direction: "lowest",
      take: 2,
      shortage: "require_full",
    }, {
      investmentId: "group-1",
      selectionId: selection.semantic_id,
      clockId: "daily-close",
    });
    expect(operation).toMatchObject({
      kind: "set_program_selection",
      semantic_id: selection.semantic_id,
      selection: {
        semantic_id: "blocky-select-draft-start-definition",
        universe_id: "group-1",
        eligibility: null,
        ranking: { kind: "trailing_return", observations: 84 },
        direction: "ascending",
        count: 2,
        shortage_policy: "require_full",
      },
    });
    expect(strategy.program?.statements[0]).toEqual(expect.objectContaining({
      kind: "on_event",
      statements: [selection, buy],
    }));
  });
});
