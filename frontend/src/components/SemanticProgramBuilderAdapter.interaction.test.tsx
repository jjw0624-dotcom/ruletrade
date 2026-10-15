// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalStrategyV2 } from "../domain/canonicalV2";

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
  ReactFlow: ({ onPaneClick, nodesDraggable, panOnDrag }: { onPaneClick?: () => void; nodesDraggable?: boolean; panOnDrag?: boolean }) => <button type="button" data-testid="flow-pane" data-nodes-draggable={String(nodesDraggable)} data-pan-on-drag={String(panOnDrag)} onClick={onPaneClick}>Flow canvas</button>,
}));

vi.mock("./ProductBlockyProjection", () => ({
  ProgramBlockyProjection: () => <div data-testid="blocky-workspace">Blocky workspace</div>,
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

  function render(initialView: "overview" | "guided" | "flow" | "blocky" = "overview", apply = vi.fn()) {
    act(() => root.render(<SemanticProgramBuilderAdapter
      canonical={blank} dirty={false} status="saved" message="Saved" initialView={initialView}
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

  it("keeps Structure and Add ownership exclusive with separated tool content", async () => {
    render();
    expect(container.textContent).not.toContain("A capital path backed by assets.");
    await clickButton(container, "Add");
    expect(container.textContent).toContain("A capital path backed by assets.");
    expect(container.querySelector('small[aria-label="Availability status"]')?.textContent).toBe("Ready");
    await clickButton(container, "Structure");
    expect(container.textContent).not.toContain("A capital path backed by assets.");
  });

  it("opens, closes, and clears focus that has no target in the next view", async () => {
    render();
    await clickButton(container, "Portfolio");
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeTruthy();
    await clickButton(container, "Guide");
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeNull();
    await clickButton(container, "Summary");
    await clickButton(container, "Portfolio");
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeTruthy();
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close Inspector"]');
    expect(close).toBeTruthy();
    act(() => close!.click());
    expect(container.querySelector('[aria-label="Semantic Inspector"]')).toBeNull();
  });

  it("keeps Flow node drag and canvas pan as independent production interactions", () => {
    render("flow");
    const canvas = container.querySelector('[data-testid="flow-pane"]');
    expect(canvas?.getAttribute("data-nodes-draggable")).toBe("true");
    expect(canvas?.getAttribute("data-pan-on-drag")).toBe("true");
  });

  it("starts asset-first intent in the production Builder and preserves contribution honestly", async () => {
    render("flow");
    await clickButton(container, "Add");
    await clickButton(container, "Destination");
    await clickTool(container, "Assets");
    expect(container.querySelector('[data-intent-recipe="single_asset"]')).toBeTruthy();
    const manual = container.querySelector<HTMLInputElement>('input[aria-label="Manual asset symbol"]')!;
    await changeValue(manual, "QQQ");
    await clickButton(container, "Add symbol");
    await clickButton(container, "Use selected assets");
    const timing = container.querySelector<HTMLSelectElement>('select[aria-label="Intent timing"]')!;
    const meaning = container.querySelector<HTMLSelectElement>('select[aria-label="Timing meaning"]')!;
    await changeValue(timing, "monthly");
    await changeValue(meaning, "contribution");
    expect(container.textContent).toContain("Recurring contributions are preserved as intent");
    expect([...container.querySelectorAll("button")].find((item) => item.textContent === "Commit strategy meaning")?.hasAttribute("disabled")).toBe(true);
  });

  it("commits a reviewed weighted Score recipe through one typed operation", async () => {
    const apply = vi.fn();
    render("blocky", apply);
    await clickButton(container, "Add");
    await clickButton(container, "Data");
    await clickTool(container, "Weighted Score");
    expect(container.querySelector('[data-intent-recipe="weighted_score"]')).toBeTruthy();
    expect(container.textContent).toContain("Allocate proportionally to positive Score");
    await clickButton(container, "Commit strategy meaning");
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: "commit_weighted_score_intent", count: 3 }));
  });

  it.each([
    ["blocky", "Logic", "Market regime rotation", "commit_market_regime_rotation_intent"],
    ["flow", "Capital", "Growth + Defensive", "commit_split_portfolio_intent"],
    ["blocky", "Data", "Weighted Score", "commit_weighted_score_intent"],
    ["blocky", "State", "Breakout sequence", "commit_temporal_sequence_intent"],
    ["blocky", "State", "Weekly context + daily signal", "commit_multi_clock_policy_intent"],
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
