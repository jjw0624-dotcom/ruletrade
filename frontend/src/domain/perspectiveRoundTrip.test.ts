import { describe, expect, it } from "vitest";
import { compileActiveVisualGraph } from "./activeVisualGraph";
import { createFinancialIntentDraft } from "./intentAuthoring";
import { addCanvasBlock, emptyProgramWorkingDraft, loadProgramWorkingDraft, persistProgramWorkingDraft, programDraftForPerspective, setCanvasBlockActive, withBlockMove, withPerspectiveProgramDraft, type ProgramCanvasBlock } from "./programWorkingDraft";

const block = (id: string, definitionId: string, extra: Partial<ProgramCanvasBlock> = {}): ProgramCanvasBlock => ({ id, definitionId, label: definitionId, createdAt: "2026-10-18T00:00:00Z", active: false, ...extra });

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe("independent perspective round trips", () => {
  it("preserves a Rules-first incomplete intent across save and reopen without Blockly meaning", () => {
    const storage = memoryStorage();
    const source = withPerspectiveProgramDraft(emptyProgramWorkingDraft("rules-round-trip"), "rules", createFinancialIntentDraft("single_asset", "rules_first"));
    persistProgramWorkingDraft(source, storage);
    const reopened = loadProgramWorkingDraft("rules-round-trip", storage);
    expect(programDraftForPerspective(reopened, "rules")).toMatchObject({ kind: "financial_intent", recipe: "single_asset", startPath: "rules_first" });
    expect(reopened.canvasBlocks).toEqual({});
    expect(reopened.activeGraphRootIds).toEqual([]);
  });

  it("replays the same typed Blocky operation after Working Draft persistence", () => {
    const storage = memoryStorage();
    let source = emptyProgramWorkingDraft("blocky-round-trip");
    source = addCanvasBlock(source, block("draft:start", "start-monthly"), { x: 0, y: 0 });
    source = addCanvasBlock(source, block("draft:rebalance", "rebalance"), { x: 0, y: 80 });
    source = addCanvasBlock(source, block("draft:asset", "asset-reference", { objectRef: "QQQ" }), { x: 120, y: 80 });
    source = addCanvasBlock(source, block("draft:weight", "percentage", { fieldValues: { VALUE: 100 } }), { x: 240, y: 80 });
    source = withBlockMove(source, "draft:rebalance", { x: 0, y: 80 }, { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" });
    source = withBlockMove(source, "draft:asset", { x: 120, y: 80 }, { childId: "draft:asset", parentId: "draft:rebalance", inputName: "TARGET" });
    source = withBlockMove(source, "draft:weight", { x: 240, y: 80 }, { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" });
    source = setCanvasBlockActive(source, "draft:start", true);
    const before = compileActiveVisualGraph(source);
    persistProgramWorkingDraft(source, storage);
    const after = compileActiveVisualGraph(loadProgramWorkingDraft("blocky-round-trip", storage));
    expect(after).toEqual(before);
    expect(after.operation).toMatchObject({ kind: "commit_single_asset_intent", asset: "QQQ", timeframe: "monthly" });
  });
});
