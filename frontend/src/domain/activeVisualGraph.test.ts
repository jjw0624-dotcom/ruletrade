import { describe, expect, it } from "vitest";
import { compileActiveVisualGraph, validateActiveVisualGraphs } from "./activeVisualGraph";
import { addCanvasBlock, emptyProgramWorkingDraft, setCanvasBlockActive, withBlockMove } from "./programWorkingDraft";

const block = (id: string, definitionId: string) => ({ id, definitionId, label: definitionId, createdAt: "2026-10-18T00:00:00Z", active: false });

describe("active visual graph translation boundary", () => {
  it("ignores disconnected alternatives and validates only explicit active roots", () => {
    let draft = emptyProgramWorkingDraft("active");
    draft = addCanvasBlock(draft, block("draft:start", "start-monthly"), { x: 20, y: 20 });
    draft = addCanvasBlock(draft, block("draft:rebalance", "rebalance"), { x: 20, y: 120 });
    draft = addCanvasBlock(draft, block("draft:random", "random-value"), { x: 400, y: 20 });
    draft = withBlockMove(draft, "draft:rebalance", { x: 20, y: 120 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
    draft = setCanvasBlockActive(draft, "draft:start", true);
    expect(validateActiveVisualGraphs(draft)).toMatchObject({ status: "valid", graphs: [{ rootId: "draft:start", blockIds: ["draft:start", "draft:rebalance"], capability: "incomplete" }] });
  });

  it("rejects a non-Start active root and keeps draft-only execution distinct", () => {
    let invalid = addCanvasBlock(emptyProgramWorkingDraft("invalid"), block("draft:loop", "repeat-while"), { x: 0, y: 0 });
    invalid = setCanvasBlockActive(invalid, "draft:loop", true);
    expect(validateActiveVisualGraphs(invalid).status).toBe("invalid");

    let draftOnly = addCanvasBlock(emptyProgramWorkingDraft("draft-only"), block("draft:start", "start-signal"), { x: 0, y: 0 });
    draftOnly = addCanvasBlock(draftOnly, block("draft:signal", "signal-reference"), { x: 0, y: 80 });
    draftOnly = withBlockMove(draftOnly, "draft:signal", { x: 0, y: 80 }, { childId: "draft:signal", parentId: "draft:start", inputName: "SIGNAL" });
    draftOnly = setCanvasBlockActive(draftOnly, "draft:start", true);
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

  it("compiles the proven monthly single-asset rebalance graph into one atomic intent", () => {
    let draft = emptyProgramWorkingDraft("compile-monthly");
    draft = addCanvasBlock(draft, block("draft:start", "start-monthly"), { x: 20, y: 20 });
    draft = addCanvasBlock(draft, block("draft:rebalance", "rebalance"), { x: 20, y: 100 });
    draft = addCanvasBlock(draft, { ...block("draft:asset", "asset-reference"), objectRef: "QQQ" }, { x: 180, y: 100 });
    draft = addCanvasBlock(draft, { ...block("draft:weight", "percentage"), fieldValues: { VALUE: 100 } }, { x: 280, y: 100 });
    draft = withBlockMove(draft, "draft:rebalance", { x: 20, y: 100 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
    draft = withBlockMove(draft, "draft:asset", { x: 180, y: 100 }, { childId: "draft:asset", parentId: "draft:rebalance", inputName: "TARGET" });
    draft = withBlockMove(draft, "draft:weight", { x: 280, y: 100 }, { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" });
    draft = setCanvasBlockActive(draft, "draft:start", true);
    expect(compileActiveVisualGraph(draft)).toMatchObject({ status: "ready", rootId: "draft:start", operation: { kind: "commit_single_asset_intent", asset: "QQQ", timeframe: "monthly", timing_meaning: "rebalance" } });
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
    draft = setCanvasBlockActive(draft, "draft:start", true);
    expect(compileActiveVisualGraph(draft)).toMatchObject({ status: "unsupported", operation: null });
  });
});
