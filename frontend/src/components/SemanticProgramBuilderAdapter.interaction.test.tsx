// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalStrategyV2 } from "../domain/canonicalV2";
import { emptyProgramWorkingDraft } from "../domain/programWorkingDraft";

vi.mock("../assetWorkspaceApi", () => ({
  assetWorkspaceApi: {
    list: vi.fn().mockResolvedValue({ items: [] }),
    detail: vi.fn().mockRejectedValue(new Error("No fixture detail")),
    compare: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
  ReactFlow: ({ onPaneClick, onNodeDragStop, onMoveEnd, nodes = [], nodesDraggable, panOnDrag }: { onPaneClick?: () => void; onNodeDragStop?: (event: unknown, node: { id: string; position: { x: number; y: number } }) => void; onMoveEnd?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void; nodes?: Array<{ id: string }>; nodesDraggable?: boolean; panOnDrag?: boolean }) => <div><button type="button" data-testid="flow-pane" data-nodes-draggable={String(nodesDraggable)} data-pan-on-drag={String(panOnDrag)} onClick={onPaneClick}>Flow canvas</button><button type="button" data-testid="flow-node-drag" onClick={() => nodes[0] && onNodeDragStop?.({}, { id: nodes[0].id, position: { x: 510, y: 240 } })}>Move node</button><button type="button" data-testid="flow-pan" onClick={() => onMoveEnd?.({}, { x: 80, y: 45, zoom: .9 })}>Pan canvas</button></div>,
}));

vi.mock("./ProductBlockyProjection", () => ({
  ProgramBlockyProjection: ({ nodes = [], onBlockMove, onWorkspaceChange, onCreateGroup }: { nodes?: Array<{ id: string }>; onBlockMove?: (id: string, position: { x: number; y: number }, parentId: string | null, inputName: string | null) => void; onWorkspaceChange?: (snapshot: unknown) => void; onCreateGroup?: (request?: { parentId: string; inputName: string }) => void }) => <div data-testid="blocky-workspace">Blocky workspace<button type="button" data-testid="blocky-move" onClick={() => nodes[0] && onBlockMove?.(nodes[0].id, { x: 420, y: 180 }, null, null)}>Move block</button><button type="button" data-testid="native-invest" onClick={() => onWorkspaceChange?.({ workspace: { blocks: {} }, viewport: null, canvasBlocks: { "draft:invest-native": { id: "draft:invest-native", definitionId: "invest", label: "Invest [A] by [B]", active: false, createdAt: "2026-10-18T00:00:00Z" } }, positions: { "draft:invest-native": { x: 200, y: 100 } }, connections: { "draft:invest-native": { childId: "draft:invest-native", parentId: null, inputName: null } }, disclosure: { "draft:invest-native": 1 }, selectedDraftId: "draft:invest-native", nativeObjects: [] })}>Native Invest block</button><button type="button" data-testid="native-create-group-for-slot" onClick={() => onCreateGroup?.({ parentId: "draft:invest-native", inputName: "TARGET" })}>Create Group for target slot</button></div>,
}));

import { SemanticProgramBuilderAdapter } from "./SemanticProgramBuilderAdapter";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const blank: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Interaction test", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "initial-assets", assets: [] }], groups: [],
    asset_axis: { name: "asset", domain_id: "initial-assets", coordinate_policy: "member_identity" },
  },
  operator_lock: {}, selection: null, predicate: null,
  program: { semantic_id: "program", clocks: [], initial_state: {}, formalizations: [], statements: [] },
};

const growthDefensive: CanonicalStrategyV2 = {
  ...blank,
  metadata: { ...blank.metadata, name: "Growth + Defensive" },
  definitions: {
    asset_sets: [
      { id: "growth-assets", assets: ["QQQ", "VGT", "SOXX", "SCHG"] },
      { id: "defensive-assets", assets: ["IEF"] },
    ],
    groups: [
      { id: "growth", name: "Growth", asset_set_ref: "growth-assets", description: "" },
      { id: "defensive", name: "Defensive", asset_set_ref: "defensive-assets", description: "" },
    ],
    asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" },
  },
  program: {
    semantic_id: "program", initial_state: {}, formalizations: [],
    clocks: [{ id: "monthly-close", timeframe: "monthly", boundary: "close", timezone: "UTC", completed_only: true }],
    statements: [{
      kind: "select", semantic_id: "growth-selection", output_id: "growth-selected", clock_id: "monthly-close",
      selection: {
        semantic_id: "growth-selection-definition", universe_id: "growth",
        binding: { id: "growth-candidate", domain_id: "growth" }, eligibility: null,
        ranking: { semantic_id: "growth-return", kind: "trailing_return", operands: [{ semantic_id: "growth-close", kind: "observe", operands: [], subject_kind: "candidate", subject_id: null, binding_id: "growth-candidate", field: "close", basis: "adjusted", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 }], observations: 126, skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 },
        direction: "descending", count: 2, shortage_policy: "require_full", fallback_asset: "TLT",
      },
    }, {
      kind: "allocate", semantic_id: "portfolio-split", method: "fixed", clock_id: "monthly-close",
      legs: [
        { semantic_id: "growth-leg", target: { semantic_id: "growth-target", kind: "group", ref: "growth" }, weight: .7 },
        { semantic_id: "defensive-leg", target: { semantic_id: "defensive-target", kind: "group", ref: "defensive" }, weight: .3 },
      ], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null,
    }],
  },
};

async function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  expect(button, `button ${label}`).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button!.click();
  });
}

async function clickTool(container: HTMLElement, label: string) {
  const strong = [...container.querySelectorAll("button strong")].find((item) => item.textContent?.trim() === label);
  const button = strong?.closest("button");
  expect(button, `tool ${label}`).toBeTruthy();
  await act(async () => button!.click());
}

async function clickStructureItem(container: HTMLElement, label: string) {
  const item = [...container.querySelectorAll("button.structure-item > span")].find((candidate) => candidate.textContent?.trim() === label);
  const button = item?.closest("button");
  expect(button, `structure item ${label}`).toBeTruthy();
  await act(async () => button!.click());
}

async function changeValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("SemanticProgram Builder interaction lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(initialView: "overview" | "guided" | "flow" | "blocky" = "overview", apply = vi.fn(), canonical: CanonicalStrategyV2 = blank) {
    act(() => root.render(<SemanticProgramBuilderAdapter
      canonical={canonical} dirty={false} status="saved" message="Saved" initialView={initialView}
      onHome={() => undefined} apply={apply} save={() => undefined}
      undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
      working={() => undefined} run={() => undefined} executionCapability={null}
    />));
  }

  it("mounts Blocky once and preserves the workspace element across representations", async () => {
    render("blocky");
    const workspace = container.querySelector('[data-testid="blocky-workspace"]');
    expect(workspace).toBeTruthy();
    await clickButton(container, "Flow");
    await clickButton(container, "Blocky");
    expect(container.querySelector('[data-testid="blocky-workspace"]')).toBe(workspace);
  });

  it("keeps layout-only Blocky drag out of Canonical and supports workspace undo/redo", async () => {
    const apply = vi.fn();
    const onWorkingDraftChange = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("growth-defensive"));
      return <SemanticProgramBuilderAdapter
        canonical={growthDefensive} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={apply} save={() => undefined}
        undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
        working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { onWorkingDraftChange(next); setDraft(next); }}
      />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="blocky-move"]')!.click());
    const moved = onWorkingDraftChange.mock.calls.at(-1)?.[0];
    expect(Object.values(moved.blockPositions)).toContainEqual({ x: 420, y: 180 });
    expect(apply).not.toHaveBeenCalled();
    await clickButton(container, "Undo");
    expect(onWorkingDraftChange.mock.calls.at(-1)?.[0].blockPositions).toEqual({});
    await clickButton(container, "Redo");
    expect(Object.values(onWorkingDraftChange.mock.calls.at(-1)?.[0].blockPositions)).toContainEqual({ x: 420, y: 180 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps Structure and Add ownership exclusive with separated tool content", async () => {
    render();
    expect(container.textContent).not.toContain("Connect Portfolio capital to an Asset, Group, or selected Subgroup.");
    await clickButton(container, "Add");
    expect(container.textContent).toContain("Connect Portfolio capital to an Asset, Group, or selected Subgroup.");
    expect(container.querySelector('small[aria-label="Availability status"]')?.textContent).toBe("Draftable");
    await clickButton(container, "Structure");
    expect(container.textContent).not.toContain("Connect Portfolio capital to an Asset, Group, or selected Subgroup.");
  });

  it("keeps Inspector focus across representation changes and closes only on intent", async () => {
    render();
    await clickButton(container, "Portfolio");
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeTruthy();
    await clickButton(container, "Guide");
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeTruthy();
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close Inspector"]');
    expect(close).toBeTruthy();
    act(() => close!.click());
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeNull();
  });

  it("keeps Test results in the right detail rail and restores Inspector navigation", async () => {
    act(() => root.render(<SemanticProgramBuilderAdapter
      canonical={blank} dirty={false} status="saved" message="Saved" initialView="overview"
      onHome={() => undefined} apply={() => undefined} save={() => undefined}
      undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
      working={() => undefined} run={() => undefined} executionCapability={null}
      testPanel={<div>Runtime evidence</div>} onCloseTestPanel={() => undefined}
    />));
    expect(container.querySelector('[aria-label="Test results"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeNull();
    expect(container.textContent).toContain("Runtime evidence");
  });

  it("keeps Flow node drag and canvas pan as independent production interactions", () => {
    render("flow");
    const canvas = container.querySelector('[data-testid="flow-pane"]');
    expect(canvas?.getAttribute("data-nodes-draggable")).toBe("true");
    expect(canvas?.getAttribute("data-pan-on-drag")).toBe("true");
  });

  it("persists Flow drag and pan only in Working Draft without semantic operations", async () => {
    const apply = vi.fn();
    const onWorkingDraftChange = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("growth-defensive"));
      return <SemanticProgramBuilderAdapter canonical={growthDefensive} dirty={false} status="saved" message="Saved" initialView="flow"
        onHome={() => undefined} apply={apply} save={() => undefined}
        undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
        working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { onWorkingDraftChange(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="flow-node-drag"]')!.click());
    const moved = onWorkingDraftChange.mock.calls.at(-1)?.[0];
    expect(Object.values(moved.flowPositions)).toContainEqual({ x: 510, y: 240 });
    expect(apply).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="flow-pan"]')!.click());
    const panned = onWorkingDraftChange.mock.calls.at(-1)?.[0];
    expect(panned.flowViewport).toEqual({ x: 80, y: 45, zoom: .9 });
    expect(Object.values(panned.flowPositions)).toContainEqual({ x: 510, y: 240 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("delegates the Blocky palette to the native shaped category flyout", async () => {
    render("blocky", vi.fn(), growthDefensive);
    await clickButton(container, "Add");
    expect(container.textContent).toContain("Use the native colored categories and shaped flyout attached to the Blocky canvas.");
    expect(container.querySelectorAll(".blocky-toolbox-entry")).toHaveLength(0);
  });

  it("starts Investment as Investment and never substitutes an IF draft", async () => {
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("investment-regression"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="native-invest"]')!.click());
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(latest.canvasBlocks["draft:invest-native"]).toMatchObject({ definitionId: "invest" });
    expect(Object.values(latest.canvasBlocks as Record<string, { definitionId: string }>).some((item) => item.definitionId === "if-otherwise")).toBe(false);
    expect(latest.concept).toBeNull();
  });

  it("creates a Group for an empty typed target slot and connects only the explicit reference", async () => {
    const apply = vi.fn();
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("group-slot"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="native-invest"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="native-create-group-for-slot"]')!.click());
    expect(container.querySelector(".group-draft")).toBeTruthy();
    await clickButton(container, "Create Group");
    const latest = changes.mock.calls.at(-1)?.[0];
    const reference = Object.values(latest.canvasBlocks as Record<string, { id: string; definitionId: string; objectRef: string }>).find((item) => item.definitionId === "group-reference")!;
    expect(reference.objectRef).toBe("group-1");
    expect(latest.blockConnections[reference.id]).toMatchObject({ parentId: "draft:invest-native", inputName: "TARGET" });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: "add_program_group" }));
  });

  it("keeps Inspector focused on the same semantic address after reconciliation", async () => {
    const apply = vi.fn();
    render("blocky", apply, growthDefensive);
    await clickStructureItem(container, "Group · Growth");
    const inspector = container.querySelector('[aria-label="Semantic Inspector"]');
    expect(inspector).toBeTruthy();
    const updated = structuredClone(growthDefensive);
    const selection = updated.program!.statements[0];
    if (selection.kind === "select") selection.selection.count = 3;
    render("blocky", apply, updated);
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBe(inspector);
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBe(inspector);
  });

  it("starts asset-first Group authoring without fabricating Investment or timing", async () => {
    const apply = vi.fn();
    render("flow", apply);
    await clickButton(container, "Objects");
    await clickButton(container, "Create Group");
    expect(container.querySelector(".group-draft")).toBeTruthy();
    const manual = container.querySelector<HTMLInputElement>('input[aria-label="Manual asset symbol"]')!;
    await changeValue(manual, "QQQ");
    await clickButton(container, "Add symbol");
    await clickButton(container, "Use selected assets");
    expect(container.querySelector(".group-draft")).toBeTruthy();
    expect(container.querySelector('[aria-label="Selected assets"]')?.textContent).toContain("QQQ");
    expect(apply).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "set_program_investment" }));
    expect(apply).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "set_program_schedule" }));
  });

  it("opens the large Group Workspace from an existing Group", async () => {
    render("blocky", vi.fn(), growthDefensive);
    await clickStructureItem(container, "Group · Growth");
    await clickButton(container, "Edit Assets");
    expect(container.querySelector('[aria-label="Group Workspace"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Search assets by ticker or name"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Selected assets"]')?.textContent).toContain("QQQ");
  });

  it.each([
    ["flow", "Capital", "Growth + Defensive", "commit_split_portfolio_intent"],
  ] as const)("commits %s/%s intent through production controls", async (view, category, tool, kind) => {
    const apply = vi.fn();
    render(view, apply);
    await clickButton(container, "Add");
    await clickButton(container, category);
    await clickTool(container, tool);
    await clickButton(container, "Commit strategy meaning");
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind }));
  });

  it.each([
    ["Destination", "Rotation universe", "market_regime_rotation"],
    ["Allocation", "Growth / Defensive 70 / 30", "split_portfolio"],
    ["Destination", "Score universe", "weighted_score"],
    ["Destination", "Breakout asset", "temporal_sequence"],
    ["Behavior", "Risk policy first", "multi_clock_policy"],
  ] as const)("keeps alternate %s/%s construction as an incomplete draft", async (category, tool, recipe) => {
    const apply = vi.fn();
    render("flow", apply);
    await clickButton(container, "Add");
    await clickButton(container, category);
    await clickTool(container, tool);
    expect(container.querySelector(`[data-intent-recipe="${recipe}"]`)).toBeTruthy();
    expect([...container.querySelectorAll("button")].find((item) => item.textContent === "Commit strategy meaning")?.hasAttribute("disabled")).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
});
