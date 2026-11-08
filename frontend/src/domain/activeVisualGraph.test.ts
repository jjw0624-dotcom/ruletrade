import { describe, expect, it } from "vitest";
import { compileActiveVisualGraph, validateActiveVisualGraphs } from "./activeVisualGraph";
import type { CanonicalStrategyV2 } from "./canonicalV2";
import { addCanvasBlock, emptyProgramWorkingDraft, withBlockMove } from "./programWorkingDraft";

const block = (id: string, definitionId: string) => ({ id, definitionId, label: definitionId, createdAt: "2026-10-18T00:00:00Z", active: false });


const canonicalWithGroup = (timeframe: "daily" | "monthly" = "daily"): CanonicalStrategyV2 => ({
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Group strategy", description: "", tags: [] },
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
    clocks: [{ id: `${timeframe}-close`, timeframe, boundary: "close", timezone: "America/New_York", completed_only: true }],
    initial_state: {},
    statements: [],
  },
});

const completeGroupRebalance = (weight = 100) => {
  let draft = emptyProgramWorkingDraft("group-rebalance");
  draft = addCanvasBlock(draft, block("draft:start", "start-daily"), { x: 0, y: 0 });
  draft = addCanvasBlock(draft, block("draft:rebalance", "rebalance"), { x: 0, y: 80 });
  draft = addCanvasBlock(draft, { ...block("draft:group", "group-reference"), objectRef: "group-1" }, { x: 100, y: 80 });
  draft = addCanvasBlock(draft, { ...block("draft:weight", "percentage"), fieldValues: { VALUE: weight } }, { x: 200, y: 80 });
  draft = withBlockMove(draft, "draft:rebalance", { x: 0, y: 80 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
  draft = withBlockMove(draft, "draft:group", { x: 100, y: 80 }, { childId: "draft:group", parentId: "draft:rebalance", inputName: "TARGET" });
  return withBlockMove(draft, "draft:weight", { x: 200, y: 80 }, { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" });
};

describe("active visual graph translation boundary", () => {
  it("infers connected Start graphs and ignores disconnected alternatives", () => {
    let draft = emptyProgramWorkingDraft("active");
    draft = addCanvasBlock(draft, block("draft:start", "start-monthly"), { x: 20, y: 20 });
    draft = addCanvasBlock(draft, block("draft:rebalance", "rebalance"), { x: 20, y: 120 });
    draft = addCanvasBlock(draft, block("draft:random", "random-value"), { x: 400, y: 20 });
    draft = withBlockMove(draft, "draft:rebalance", { x: 20, y: 120 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
    expect(validateActiveVisualGraphs(draft)).toMatchObject({ status: "valid", graphs: [{ rootId: "draft:start", blockIds: ["draft:start", "draft:rebalance"], capability: "incomplete" }] });
  });

  it("ignores disconnected non-Start fragments and keeps draft-only execution distinct", () => {
    const fragment = addCanvasBlock(emptyProgramWorkingDraft("fragment"), block("draft:loop", "repeat-while"), { x: 0, y: 0 });
    expect(validateActiveVisualGraphs(fragment)).toMatchObject({ status: "valid", graphs: [] });

    let draftOnly = addCanvasBlock(emptyProgramWorkingDraft("draft-only"), block("draft:start", "start-signal"), { x: 0, y: 0 });
    draftOnly = addCanvasBlock(draftOnly, block("draft:signal", "signal-reference"), { x: 0, y: 80 });
    draftOnly = withBlockMove(draftOnly, "draft:signal", { x: 0, y: 80 }, { childId: "draft:signal", parentId: "draft:start", inputName: "SIGNAL" });
    expect(validateActiveVisualGraphs(draftOnly).graphs[0]?.capability).toBe("draft_only");
  });

  it("preserves an invalid legacy Group-to-number edge and reports it without reinterpretation", () => {
    let draft = emptyProgramWorkingDraft("legacy-mismatch");
    draft = addCanvasBlock(draft, block("draft:compare", "compare-gt"), { x: 20, y: 20 });
    draft = addCanvasBlock(draft, { ...block("draft:group", "group-reference"), objectRef: "group-stable-17" }, { x: 20, y: 100 });
    draft = withBlockMove(draft, "draft:group", { x: 20, y: 100 }, { childId: "draft:group", parentId: "draft:compare", inputName: "A" });
    expect(draft.blockConnections["draft:group"]).toMatchObject({ parentId: "draft:compare", inputName: "A" });
    expect(validateActiveVisualGraphs(draft).diagnostics).toContainEqual(expect.objectContaining({ code: "typed_connection_mismatch", blockId: "draft:group" }));
  });


  it("rejects duplicate Starts for the same event type without inventing order", () => {
    let draft = emptyProgramWorkingDraft("duplicate-daily");
    draft = addCanvasBlock(draft, block("draft:start-a", "start-daily"), { x: 0, y: 0 });
    draft = addCanvasBlock(draft, block("draft:start-b", "start-daily"), { x: 300, y: 0 });
    expect(validateActiveVisualGraphs(draft)).toMatchObject({
      status: "invalid",
      diagnostics: [
        { code: "duplicate_start_event_type", blockId: "draft:start-a" },
        { code: "duplicate_start_event_type", blockId: "draft:start-b" },
      ],
    });
  });

  it("compiles the proven monthly single-asset rebalance graph into one atomic intent", () => {
    let draft = emptyProgramWorkingDraft("compile-monthly");
    draft = addCanvasBlock(draft, block("draft:start", "start-monthly"), { x: 20, y: 20 });
    draft = addCanvasBlock(draft, block("draft:rebalance", "rebalance"), { x: 20, y: 100 });
    draft = addCanvasBlock(draft, { ...block("draft:asset", "asset-reference"), objectRef: "QQQ" }, { x: 180, y: 100 });
    draft = addCanvasBlock(draft, { ...block("draft:weight", "percentage"), fieldValues: { VALUE: 100 } }, { x: 280, y: 100 });
    draft = withBlockMove(draft, "draft:rebalance", { x: 20, y: 100 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
    draft = withBlockMove(draft, "draft:asset", { x: 180, y: 100 }, { childId: "draft:asset", parentId: "draft:rebalance", inputName: "TARGET" });
    draft = withBlockMove(draft, "draft:weight", { x: 280, y: 100 }, { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" });
    expect(compileActiveVisualGraph(draft)).toMatchObject({ status: "ready", rootId: "draft:start", operation: { kind: "commit_single_asset_intent", asset: "QQQ", timeframe: "monthly", timing_meaning: "rebalance" } });
  });

  it("compiles a resolved Group rebalance through the existing typed investment operation", () => {
    expect(compileActiveVisualGraph(completeGroupRebalance(), canonicalWithGroup())).toMatchObject({
      status: "ready",
      rootId: "draft:start",
      operation: {
        kind: "set_program_investment",
        semantic_id: "blocky-investment-draft-start",
        target_kind: "group",
        target_ref: "group-1",
        internal_allocation: "equal",
        clock_id: "daily-close",
      },
    });
  });

  it("does not compile a stale Group reference or invent a missing clock", () => {
    const missingGroup = canonicalWithGroup();
    missingGroup.definitions.groups = [];
    expect(compileActiveVisualGraph(completeGroupRebalance(), missingGroup)).toMatchObject({ status: "unsupported", operation: null });

    const missingClock = canonicalWithGroup();
    missingClock.program!.clocks = [];
    expect(compileActiveVisualGraph(completeGroupRebalance(), missingClock)).toMatchObject({ status: "unsupported", operation: null });
  });

  it("does not reinterpret a partial Group allocation as a 100% investment", () => {
    expect(compileActiveVisualGraph(completeGroupRebalance(50), canonicalWithGroup())).toMatchObject({ status: "unsupported", operation: null });
  });

  it("keeps a complete 50% graph unsupported instead of changing its intended weight", () => {
    let draft = emptyProgramWorkingDraft("counterexample");
    draft = addCanvasBlock(draft, block("draft:start", "start-daily"), { x: 0, y: 0 });
    draft = addCanvasBlock(draft, block("draft:rebalance", "rebalance"), { x: 0, y: 80 });
    draft = addCanvasBlock(draft, { ...block("draft:asset", "asset-reference"), objectRef: "QQQ" }, { x: 100, y: 80 });
    draft = addCanvasBlock(draft, { ...block("draft:weight", "percentage"), fieldValues: { VALUE: 50 } }, { x: 200, y: 80 });
    draft = withBlockMove(draft, "draft:rebalance", { x: 0, y: 80 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
    draft = withBlockMove(draft, "draft:asset", { x: 100, y: 80 }, { childId: "draft:asset", parentId: "draft:rebalance", inputName: "TARGET" });
    draft = withBlockMove(draft, "draft:weight", { x: 200, y: 80 }, { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" });
    expect(compileActiveVisualGraph(draft)).toMatchObject({ status: "unsupported", operation: null });
  });
  it("compiles a direct Group Buy with units each without converting it to target weight", () => {
    let draft = emptyProgramWorkingDraft("group-buy");
    draft = addCanvasBlock(draft, block("draft:start-buy", "start-daily"), { x: 0, y: 0 });
    draft = addCanvasBlock(draft, block("draft:buy", "invest"), { x: 0, y: 80 });
    draft = addCanvasBlock(draft, { ...block("draft:buy-group", "group-reference"), objectRef: "group-1" }, { x: 120, y: 80 });
    draft = addCanvasBlock(draft, { ...block("draft:units", "units-each"), fieldValues: { VALUE: 1 } }, { x: 240, y: 80 });
    draft = withBlockMove(draft, "draft:buy", { x: 0, y: 80 }, { childId: "draft:buy", parentId: "draft:start-buy", inputName: "NEXT" });
    draft = withBlockMove(draft, "draft:buy-group", { x: 120, y: 80 }, { childId: "draft:buy-group", parentId: "draft:buy", inputName: "TARGET" });
    draft = withBlockMove(draft, "draft:units", { x: 240, y: 80 }, { childId: "draft:units", parentId: "draft:buy", inputName: "AMOUNT" });

    expect(compileActiveVisualGraph(draft, canonicalWithGroup())).toMatchObject({
      status: "ready",
      operation: {
        kind: "insert_program_statement",
        statement: {
          kind: "on_event",
          event: { clock_id: "daily-close", trigger: "scheduled" },
          statements: [{
            kind: "buy",
            target: { kind: "group", ref: "group-1" },
            amount: { kind: "units_each", units: 1 },
          }],
        },
      },
    });
  });

  it("rejects zero and fractional units without reinterpreting the amount", () => {
    const compile = (value: number) => {
      let draft = emptyProgramWorkingDraft("invalid-units");
      draft = addCanvasBlock(draft, block("draft:start-buy", "start-daily"), { x: 0, y: 0 });
      draft = addCanvasBlock(draft, block("draft:buy", "invest"), { x: 0, y: 80 });
      draft = addCanvasBlock(draft, { ...block("draft:buy-group", "group-reference"), objectRef: "group-1" }, { x: 120, y: 80 });
      draft = addCanvasBlock(draft, { ...block("draft:units", "units-each"), fieldValues: { VALUE: value } }, { x: 240, y: 80 });
      draft = withBlockMove(draft, "draft:buy", { x: 0, y: 80 }, { childId: "draft:buy", parentId: "draft:start-buy", inputName: "NEXT" });
      draft = withBlockMove(draft, "draft:buy-group", { x: 120, y: 80 }, { childId: "draft:buy-group", parentId: "draft:buy", inputName: "TARGET" });
      draft = withBlockMove(draft, "draft:units", { x: 240, y: 80 }, { childId: "draft:units", parentId: "draft:buy", inputName: "AMOUNT" });
      return compileActiveVisualGraph(draft, canonicalWithGroup());
    };
    expect(compile(0)).toMatchObject({ status: "unsupported", operation: null });
    expect(compile(1.5)).toMatchObject({ status: "unsupported", operation: null });
  });

});
