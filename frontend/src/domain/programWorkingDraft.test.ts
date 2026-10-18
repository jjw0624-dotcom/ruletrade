import { describe, expect, it } from "vitest";
import {
  emptyProgramWorkingDraft,
  hasFlowCycle,
  loadProgramWorkingDraft,
  persistProgramWorkingDraft,
  programDraftStorageKey,
  validProgramBlockConnection,
  withBlockPosition,
  withBlockMove,
  withBlockDisclosure,
  withProgramDraftConcept,
  addCanvasBlock,
  duplicateCanvasBlock,
  removeCanvasBlock,
  setCanvasBlockActive,
  duplicateReusableObject,
  removeReusableObject,
  renameReusableObject,
  upsertReusableObject,
} from "./programWorkingDraft";
import { createFinancialIntentDraft, updateFinancialIntentDraft } from "./intentAuthoring";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

describe("SemanticProgramV2 Working Draft", () => {
  it("persists incomplete semantic intent and independent visual geometry", () => {
    const storage = memoryStorage();
    let draft = emptyProgramWorkingDraft("strategy-1");
    draft = withProgramDraftConcept(draft, { kind: "control", semanticId: "if-1", condition: null });
    draft = withBlockPosition(draft, "draft:if-1", { x: 420, y: 180 });
    draft = withBlockDisclosure(draft, "draft:if-1", 0);
    persistProgramWorkingDraft(draft, storage);
    expect(storage.values.has(programDraftStorageKey("strategy-1"))).toBe(true);
    expect(loadProgramWorkingDraft("strategy-1", storage)).toMatchObject({
      schema: "ruletrade.dev/program-working-draft/v3",
      status: "incomplete",
      concept: { kind: "control", condition: null },
      blockPositions: { "draft:if-1": { x: 420, y: 180 } },
      blockDisclosure: { "draft:if-1": 0 },
    });
  });

  it("migrates v1 drafts without losing incomplete intent or geometry", () => {
    const storage = memoryStorage();
    storage.setItem(programDraftStorageKey("strategy-legacy"), JSON.stringify({
      ...emptyProgramWorkingDraft("strategy-legacy"),
      schema: "ruletrade.dev/program-working-draft/v1",
      status: "incomplete",
      concept: { kind: "control", semanticId: "legacy-if", condition: null },
      flowPositions: { portfolio: { x: 12, y: 34 } },
    }));
    expect(loadProgramWorkingDraft("strategy-legacy", storage)).toMatchObject({
      schema: "ruletrade.dev/program-working-draft/v3",
      status: "incomplete",
      concept: { semanticId: "legacy-if" },
      flowPositions: { portfolio: { x: 12, y: 34 } },
      blockDisclosure: {},
      diagnostics: [],
    });
  });

  it("preserves multiple disconnected alternatives, identity, layout, duplication, and active roots", () => {
    let draft = emptyProgramWorkingDraft("free-canvas");
    draft = addCanvasBlock(draft, { id: "draft:invest-1", definitionId: "invest", label: "Invest [A] by [B]", active: false, createdAt: "2026-10-18T00:00:00Z" }, { x: 100, y: 120 });
    draft = addCanvasBlock(draft, { id: "draft:if-1", definitionId: "if-otherwise", label: "IF / OTHERWISE", active: false, createdAt: "2026-10-18T00:00:01Z" }, { x: 480, y: 120 });
    draft = duplicateCanvasBlock(draft, "draft:invest-1", "draft:invest-2");
    draft = setCanvasBlockActive(draft, "draft:invest-2", true);
    expect(Object.keys(draft.canvasBlocks)).toEqual(["draft:invest-1", "draft:if-1", "draft:invest-2"]);
    expect(draft.blockPositions["draft:invest-2"]).toEqual({ x: 132, y: 152 });
    expect(draft.activeGraphRootIds).toEqual(["draft:invest-2"]);
    draft = removeCanvasBlock(draft, "draft:if-1");
    expect(draft.canvasBlocks["draft:invest-1"]).toBeTruthy();
    expect(draft.canvasBlocks["draft:if-1"]).toBeUndefined();
  });

  it("keeps connection typing and cycle detection outside Canonical", () => {
    expect(validProgramBlockConnection("statement", "CONDITION", "condition")).toBe(true);
    expect(validProgramBlockConnection("statement", "CONDITION", "statement")).toBe(false);
    expect(validProgramBlockConnection("statement", "NEXT", "statement")).toBe(true);
    expect(hasFlowCycle([{ source: "portfolio", target: "growth" }], { source: "growth", target: "portfolio" })).toBe(true);
    expect(hasFlowCycle([{ source: "portfolio", target: "growth" }], { source: "portfolio", target: "defensive" })).toBe(false);
  });

  it("protects referenced reusable objects and versions names and duplicates", () => {
    let draft = emptyProgramWorkingDraft("objects");
    draft = upsertReusableObject(draft, { id: "group-a", kind: "group", name: "Growth", version: 1, dependencies: [], capability: "verified" });
    draft = upsertReusableObject(draft, { id: "function-a", kind: "function", name: "Pick", version: 1, dependencies: ["group-a"], capability: "draft_only" });
    expect(removeReusableObject(draft, "group-a")).toMatchObject({ removed: false, dependants: ["function-a"] });
    draft = renameReusableObject(draft, "function-a", "Pick strongest");
    draft = duplicateReusableObject(draft, "function-a", "function-b", "Pick strongest copy");
    expect(draft.reusableObjects["function-a"]).toMatchObject({ name: "Pick strongest", version: 2 });
    expect(draft.reusableObjects["function-b"]).toMatchObject({ name: "Pick strongest copy", version: 1 });
  });

  it("stores Blocky geometry and a tentative connection in one draft transition", () => {
    const source = emptyProgramWorkingDraft("strategy-move");
    const canonicalSentinel = Object.freeze({ semantic_id: "unchanged-canonical" });
    const moved = withBlockMove(source, "selection-1", { x: 640, y: 220 }, { childId: "selection-1", parentId: "if-1", inputName: "THEN" });
    expect(moved.blockPositions["selection-1"]).toEqual({ x: 640, y: 220 });
    expect(moved.blockConnections["selection-1"]).toEqual({ childId: "selection-1", parentId: "if-1", inputName: "THEN" });
    expect(source.blockPositions).toEqual({});
    expect(source.blockConnections).toEqual({});
    expect(canonicalSentinel).toEqual({ semantic_id: "unchanged-canonical" });
  });

  it("recovers an incomplete financial intent without committing fabricated meaning", () => {
    const storage = memoryStorage();
    const intent = updateFinancialIntentDraft(
      createFinancialIntentDraft("single_asset", "asset_first", "intent-qqq"),
      { asset: "QQQ" },
    );
    const draft = withProgramDraftConcept(emptyProgramWorkingDraft("strategy-intent"), intent);
    persistProgramWorkingDraft(draft, storage);
    expect(loadProgramWorkingDraft("strategy-intent", storage)).toMatchObject({
      status: "incomplete",
      concept: {
        kind: "financial_intent",
        semanticId: "intent-qqq",
        recipe: "single_asset",
        values: { asset: "QQQ", timeframe: null, timingMeaning: null },
      },
    });
  });
});
