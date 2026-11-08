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
  ReactFlow: ({ onPaneClick, onNodeDragStop, onMoveEnd, onEdgesChange, nodes = [], edges = [], nodesDraggable, panOnDrag }: { onPaneClick?: () => void; onNodeDragStop?: (event: unknown, node: { id: string; position: { x: number; y: number } }) => void; onMoveEnd?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void; onEdgesChange?: (changes: Array<{ type: "remove"; id: string }>) => void; nodes?: Array<{ id: string }>; edges?: Array<{ id: string; source: string; target: string }>; nodesDraggable?: boolean; panOnDrag?: boolean }) => <div><button type="button" data-testid="flow-pane" data-nodes-draggable={String(nodesDraggable)} data-pan-on-drag={String(panOnDrag)} onClick={onPaneClick}>Flow canvas</button><button type="button" data-testid="flow-node-drag" onClick={() => nodes[0] && onNodeDragStop?.({}, { id: nodes[0].id, position: { x: 510, y: 240 } })}>Move node</button><button type="button" data-testid="flow-pan" onClick={() => onMoveEnd?.({}, { x: 80, y: 45, zoom: .9 })}>Pan canvas</button><button type="button" data-testid="flow-delete-first" onClick={() => edges[0] && onEdgesChange?.([{ type: "remove", id: edges[0].id }])}>Delete first route</button><button type="button" data-testid="flow-delete-second" onClick={() => edges[1] && onEdgesChange?.([{ type: "remove", id: edges[1].id }])}>Delete second route</button></div>,
}));

vi.mock("./ProductBlockyProjection", () => ({
  ProgramBlockyProjection: ({ nodes = [], onBlockMove, onWorkspaceChange, onWorkspaceApi, onCreateGroup }: { nodes?: Array<{ id: string }>; onBlockMove?: (id: string, position: { x: number; y: number }, parentId: string | null, inputName: string | null) => void; onWorkspaceChange?: (snapshot: unknown) => void; onWorkspaceApi?: (api: unknown) => void; onCreateGroup?: (request?: { parentId: string; inputName: string }) => void }) => {
    const api = { undo: () => undefined, redo: () => undefined, canUndo: () => false, canRedo: () => false, fieldValue: () => null, setFieldValue: () => false, dispose: () => true, insertObjectReference: (object: { id: string; name: string }, target?: { parentId: string; inputName: string }) => {
      const id = `draft:group-reference-${object.id}`;
      onWorkspaceChange?.({ workspace: { blocks: {} }, viewport: null, canvasBlocks: { [id]: { id, definitionId: "group-reference", label: object.name, active: false, objectRef: object.id, createdAt: "2026-10-18T00:00:00Z" } }, positions: { [id]: { x: 200, y: 100 } }, connections: { [id]: { childId: id, parentId: target?.parentId ?? null, inputName: target?.inputName ?? null } }, disclosure: { [id]: 1 }, selectedDraftId: id, nativeObjects: [] });
      return id;
    } };
    return <div data-testid="blocky-workspace" data-native-toolbox="category-flyout">Blocky workspace<button type="button" data-testid="blocky-move" onClick={() => nodes[0] && onBlockMove?.(nodes[0].id, { x: 420, y: 180 }, null, null)}>Move block</button><button type="button" data-testid="native-invest" onClick={() => {
    onWorkspaceApi?.(api);
    onWorkspaceChange?.({ workspace: { blocks: {} }, viewport: null, canvasBlocks: { "draft:invest-native": { id: "draft:invest-native", definitionId: "invest", label: "Invest [A] by [B]", active: false, createdAt: "2026-10-18T00:00:00Z" } }, positions: { "draft:invest-native": { x: 200, y: 100 } }, connections: { "draft:invest-native": { childId: "draft:invest-native", parentId: null, inputName: null } }, disclosure: { "draft:invest-native": 1 }, selectedDraftId: "draft:invest-native", nativeObjects: [] });
  }}>Native Invest block</button><button type="button" data-testid="native-create-group-for-slot" onClick={() => { onWorkspaceApi?.(api); onCreateGroup?.({ parentId: "draft:invest-native", inputName: "TARGET" }); }}>Create Group for target slot</button></div>;
  },
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

async function clickGroupWorkspaceButton(container: HTMLElement, label: string) {
  const workspace = container.querySelector('[data-object-definition-workspace="group"]');
  const button = [...(workspace?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === label);
  expect(button, `Group Workspace button ${label}`).toBeTruthy();
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

  it("keeps Guide authoring inside Guide without creating Blocky draft blocks", async () => {
    const apply = vi.fn();
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("guide-investment"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="guided"
        onHome={() => undefined} apply={apply} save={() => undefined}
        undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
        working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await clickButton(container, "One investment");
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(latest.perspectiveDrafts.guided).toMatchObject({ kind: "financial_intent", recipe: "single_asset", startPath: "asset_first" });
    expect(latest.canvasBlocks).toEqual({});
    expect(container.querySelector('[aria-label="Guided strategy editor"]')).toBeTruthy();
    expect(container.querySelector('[data-intent-recipe="single_asset"]')).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps the current draft when navigation selection changes and discards only on explicit intent", async () => {
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("selection-draft-lifecycle"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="guided"
        onHome={() => undefined} apply={() => undefined} save={() => undefined}
        undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
        working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await clickButton(container, "One investment");
    expect(changes.mock.calls.at(-1)?.[0].perspectiveDrafts.guided).toMatchObject({ kind: "financial_intent", recipe: "single_asset" });
    await clickButton(container, "Portfolio");
    expect(changes.mock.calls.at(-1)?.[0].perspectiveDrafts.guided).toMatchObject({ kind: "financial_intent", recipe: "single_asset" });
    expect(container.querySelector('[data-intent-recipe="single_asset"]')).toBeTruthy();
    await clickButton(container, "Discard draft");
    expect(changes.mock.calls.at(-1)?.[0].perspectiveDrafts.guided).toBeUndefined();
  });

  it("keeps Test results in an independent Dashboard above Inspector navigation", async () => {
    act(() => root.render(<SemanticProgramBuilderAdapter
      canonical={blank} dirty={false} status="saved" message="Saved" initialView="overview"
      onHome={() => undefined} apply={() => undefined} save={() => undefined}
      undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
      working={() => undefined} run={() => undefined} executionCapability={null}
      testPanel={<div>Runtime evidence</div>} onCloseTestPanel={() => undefined}
    />));
    expect(container.querySelector('[aria-label="Quick Test Dashboard"]')).toBeTruthy();
    expect(container.querySelector('.program-builder-core')?.classList.contains('inspector-open')).toBe(false);
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

  it("dispatches a precise typed removal for a complete Flow route deletion", async () => {
    const apply = vi.fn();
    act(() => root.render(<SemanticProgramBuilderAdapter canonical={growthDefensive} dirty={false} status="saved" message="Saved" initialView="flow"
      onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
      canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="flow-delete-first"]')!.click());
    expect(apply).toHaveBeenCalledWith({ kind: "remove_program_investment_allocation", semantic_id: "portfolio-split" });
  });

  it("preserves an unsupported partial Split removal as a Flow-owned draft", async () => {
    const apply = vi.fn();
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("flow-removal-draft"));
      return <SemanticProgramBuilderAdapter canonical={growthDefensive} dirty={false} status="saved" message="Saved" initialView="flow"
        onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="flow-delete-second"]')!.click());
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(latest.perspectiveDrafts.flow).toMatchObject({ kind: "flow_route_change", action: "disconnect", sourceId: "split" });
    expect(latest.status).toBe("unsupported");
    expect(container.querySelector(".flow-route-draft")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps Flow authoring in the left toolbox without duplicate central actions", () => {
    act(() => root.render(<SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="flow"
      onHome={() => undefined} apply={() => undefined} save={() => undefined}
      undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
      working={() => undefined} run={() => undefined} executionCapability={null}
      workingDraft={emptyProgramWorkingDraft("flow-surface")} onWorkingDraftChange={() => undefined} />));
    const surface = container.querySelector('[aria-label="Flow capital projection"]');
    expect(surface).toBeTruthy();
    expect([...surface!.querySelectorAll("button")].some((item) => item.textContent?.includes("Create Investment"))).toBe(false);
    expect([...surface!.querySelectorAll("button")].some((item) => item.textContent?.includes("Create Split"))).toBe(false);
    expect(surface!.textContent).not.toContain("Flow drafts stay independent");
    expect(surface!.textContent).not.toContain("complete typed intent passes validation");
  });

  it("authors an incomplete investment intent directly inside Rules", async () => {
    const apply = vi.fn();
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("rules-investment"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="rules"
        onHome={() => undefined} apply={apply} save={() => undefined}
        undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
        working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await clickButton(container, "Add investment rule");
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(latest.perspectiveDrafts.rules).toMatchObject({ kind: "financial_intent", recipe: "single_asset", startPath: "rules_first" });
    expect(latest.canvasBlocks).toEqual({});
    expect(container.querySelector('[aria-label="Rules intent editor"] [data-intent-recipe="single_asset"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Semantic Inspector"] [data-intent-recipe="single_asset"]')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("infers a complete Start graph and hands it to Test without a manual commit transaction", async () => {
    const prepareTest = vi.fn();
    const draft = {
      ...emptyProgramWorkingDraft("automatic-test"),
      canvasBlocks: {
        "draft:start": { id: "draft:start", definitionId: "start-monthly", label: "Every monthly close", active: false, createdAt: "2026-10-18T00:00:00Z" },
        "draft:rebalance": { id: "draft:rebalance", definitionId: "rebalance", label: "Rebalance", active: false, createdAt: "2026-10-18T00:00:00Z" },
        "draft:asset": { id: "draft:asset", definitionId: "asset-reference", label: "QQQ", active: false, objectRef: "QQQ", createdAt: "2026-10-18T00:00:00Z" },
        "draft:weight": { id: "draft:weight", definitionId: "percentage", label: "100%", active: false, fieldValues: { VALUE: 100 }, createdAt: "2026-10-18T00:00:00Z" },
      },
      blockConnections: {
        "draft:start": { childId: "draft:start", parentId: null, inputName: null },
        "draft:rebalance": { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" },
        "draft:asset": { childId: "draft:asset", parentId: "draft:rebalance", inputName: "TARGET" },
        "draft:weight": { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" },
      },
    };
    act(() => root.render(<SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
      onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined}
      canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} prepareTest={prepareTest} executionCapability={null}
      workingDraft={draft} onWorkingDraftChange={() => undefined} />));
    expect(container.textContent).not.toContain("Commit active graph");
    expect(container.textContent).not.toContain("Active graph root");
    const testButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim().startsWith("Test"));
    expect(testButton).toBeTruthy();
    await act(async () => testButton!.click());
    expect(prepareTest).toHaveBeenCalledWith(expect.objectContaining({ kind: "commit_single_asset_intent", asset: "QQQ", timeframe: "monthly" }));
  });

  it("uses Blockly's native category toolbox as the only Blocky Add surface", async () => {
    render("blocky", vi.fn(), growthDefensive);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Add")).toBe(true);
    expect(container.querySelector('[data-testid="blocky-workspace"]')?.getAttribute("data-native-toolbox")).toBe("category-flyout");
    expect(container.querySelectorAll(".blocky-toolbox-entry")).toHaveLength(0);
  });

  it("preserves Blocky Add state while another perspective is inspected", async () => {
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("add-preservation"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await clickButton(container, "Add");
    expect(changes.mock.calls.at(-1)?.[0].blockyAddOpen).toBe(true);
    await clickButton(container, "Flow");
    expect(changes.mock.calls.at(-1)?.[0].blockyAddOpen).toBe(true);
    await clickButton(container, "Blocky");
    expect(container.querySelector('button[role="tab"][data-state="active"]')?.textContent).toBe("Add");
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
    expect(latest.perspectiveDrafts.blocky).toBeUndefined();
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
    expect(changes.mock.calls.at(-1)?.[0].pendingObjectInsertion).toEqual({ parentId: "draft:invest-native", inputName: "TARGET" });
    await clickGroupWorkspaceButton(container, "Create Group");
    const latest = changes.mock.calls.at(-1)?.[0];
    const reference = Object.values(latest.canvasBlocks as Record<string, { id: string; definitionId: string; objectRef: string }>).find((item) => item.definitionId === "group-reference")!;
    expect(reference.objectRef).toBe("group-1");
    expect(latest.blockConnections[reference.id]).toMatchObject({ parentId: "draft:invest-native", inputName: "TARGET" });
    expect(latest.pendingObjectInsertion).toBeNull();
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: "add_program_group" }));
  });

  it("creates an Object Library Group without inserting a Blockly reference", async () => {
    const apply = vi.fn();
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("group-definition-only"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await clickButton(container, "Objects");
    await clickButton(container, "Create Group");
    const groupWorkspace = container.querySelector('[data-object-definition-workspace="group"]');
    expect(groupWorkspace).toBeTruthy();
    expect(groupWorkspace?.parentElement?.classList.contains("builder-workbench")).toBe(true);
    expect(container.querySelector(".program-builder-core")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Collapse construction panel"]')).toBeNull();
    await clickGroupWorkspaceButton(container, "Create Group");
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(Object.values(latest.canvasBlocks as Record<string, { definitionId: string }>).some((item) => item.definitionId === "group-reference" || item.definitionId === "create-group")).toBe(false);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: "add_program_group" }));
  });

  it("cancels a pending typed-slot Group transaction without inserting a reference", async () => {
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("group-slot-cancel"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="native-invest"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="native-create-group-for-slot"]')!.click());
    expect(changes.mock.calls.at(-1)?.[0].pendingObjectInsertion).toEqual({ parentId: "draft:invest-native", inputName: "TARGET" });
    await clickButton(container, "Cancel");
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(latest.pendingObjectInsertion).toBeNull();
    expect(latest.canvasBlocks["draft:invest-native"]).toBeTruthy();
    expect(Object.values(latest.canvasBlocks as Record<string, { definitionId: string }>).some((item) => item.definitionId === "group-reference")).toBe(false);
  });

  it("cancels Group creation without erasing an unrelated Blockly fragment", async () => {
    const changes = vi.fn();
    function Harness() {
      const [draft, setDraft] = React.useState(() => emptyProgramWorkingDraft("group-cancel"));
      return <SemanticProgramBuilderAdapter canonical={blank} dirty={false} status="saved" message="Saved" initialView="blocky"
        onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined}
        canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
        workingDraft={draft} onWorkingDraftChange={(next) => { changes(next); setDraft(next); }} />;
    }
    act(() => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="native-invest"]')!.click());
    await clickButton(container, "Objects");
    await clickButton(container, "Create Group");
    await clickButton(container, "Cancel");
    const latest = changes.mock.calls.at(-1)?.[0];
    expect(latest.canvasBlocks["draft:invest-native"]).toBeTruthy();
    expect(latest.perspectiveDrafts.blocky).toBeUndefined();
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
    render("blocky", apply);
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

  it("does not expose a no-op global Assets entry without a committed Selection", () => {
    render("blocky", vi.fn(), blank);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Assets")).toBe(false);
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
    ["Weighted Score allocation", "weighted_score", "commit_weighted_score_intent"],
    ["Breakout, retest, confirmation", "temporal_sequence", "commit_temporal_sequence_intent"],
    ["Weekly context, daily signal", "multi_clock_policy", "commit_multi_clock_policy_intent"],
  ] as const)("commits the advanced Guide recipe %s through a typed operation", async (label, recipe, kind) => {
    const apply = vi.fn();
    render("guided", apply);
    await clickButton(container, label);
    expect(container.querySelector(`[data-intent-recipe="${recipe}"]`)).toBeTruthy();
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
