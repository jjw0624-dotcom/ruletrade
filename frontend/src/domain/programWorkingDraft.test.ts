import { describe, expect, it } from "vitest";
import {
  emptyProgramWorkingDraft,
  hasFlowCycle,
  loadProgramWorkingDraft,
  persistProgramWorkingDraft,
  programDraftStorageKey,
  validProgramBlockConnection,
  withBlockPosition,
  withBlockDisclosure,
  withProgramDraftConcept,
} from "./programWorkingDraft";

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
      schema: "ruletrade.dev/program-working-draft/v2",
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
      schema: "ruletrade.dev/program-working-draft/v2",
      status: "incomplete",
      concept: { semanticId: "legacy-if" },
      flowPositions: { portfolio: { x: 12, y: 34 } },
      blockDisclosure: {},
      diagnostics: [],
    });
  });

  it("keeps connection typing and cycle detection outside Canonical", () => {
    expect(validProgramBlockConnection("statement", "CONDITION", "condition")).toBe(true);
    expect(validProgramBlockConnection("statement", "CONDITION", "statement")).toBe(false);
    expect(validProgramBlockConnection("statement", "NEXT", "statement")).toBe(true);
    expect(hasFlowCycle([{ source: "portfolio", target: "growth" }], { source: "growth", target: "portfolio" })).toBe(true);
    expect(hasFlowCycle([{ source: "portfolio", target: "growth" }], { source: "portfolio", target: "defensive" })).toBe(false);
  });
});
