// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalStrategyV2 } from "../domain/canonicalV2";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
  ReactFlow: ({ onPaneClick }: { onPaneClick?: () => void }) => <button type="button" data-testid="flow-pane" onClick={onPaneClick}>Flow canvas</button>,
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
  operator_lock: {}, selection: null,
  program: { semantic_id: "program", clocks: [], initial_state: {}, formalizations: [], statements: [] },
};

async function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  expect(button, `button ${label}`).toBeTruthy();
  await act(async () => button!.click());
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

  function render(initialView: "overview" | "guided" | "flow" | "blocky" = "overview") {
    act(() => root.render(<SemanticProgramBuilderAdapter
      canonical={blank} dirty={false} status="saved" message="Saved" initialView={initialView}
      onHome={() => undefined} apply={() => undefined} save={() => undefined}
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
});
