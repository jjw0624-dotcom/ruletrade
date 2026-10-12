// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lightweight-charts", () => ({
  LineSeries: {},
  createChart: () => ({
    addSeries: () => ({ setData: () => undefined }),
    timeScale: () => ({ fitContent: () => undefined }),
    applyOptions: () => undefined,
    remove: () => undefined,
  }),
}));

vi.mock("../assetWorkspaceApi", () => ({
  assetWorkspaceApi: {
    list: async () => ({ items: [
      { symbol: "QQQ", name: "Invesco QQQ", asset_type: "equity", data_status: "available" },
      { symbol: "VGT", name: "Vanguard Information Technology", asset_type: "equity", data_status: "available" },
    ] }),
    detail: async (symbol: string) => ({
      asset: { symbol, name: symbol === "QQQ" ? "Invesco QQQ" : "Vanguard Information Technology", asset_type: "equity", data_status: "available" },
      as_of: "2026-10-10", metrics: [], memberships: [], series: [], historical: null,
    }),
    compare: async () => ({ items: [] }),
  },
}));

import { ProgramAssetUniverseEditor } from "./AssetWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() { /* test boundary */ }
  disconnect() { /* test boundary */ }
  unobserve() { /* test boundary */ }
} as unknown as typeof ResizeObserver;

describe("Program asset universe authoring", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("searches by product identity, adds, reorders, removes, and commits explicit membership", async () => {
    const committed = vi.fn();
    await act(async () => { root.render(<ProgramAssetUniverseEditor assets={["QQQ"]} onCommit={committed} />); await Promise.resolve(); });
    const vgt = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Asset search results"] button')].find((button) => button.textContent?.includes("VGT"));
    expect(vgt).toBeTruthy();
    await act(async () => { vgt!.click(); await Promise.resolve(); });
    expect([...host.querySelectorAll('[aria-label="Selected assets"] li')].map((item) => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("QQQ"), expect.stringContaining("VGT")]));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Move VGT up"]')!.click());
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use selected assets")!.click());
    expect(committed).toHaveBeenCalledWith(["VGT", "QQQ"]);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Remove QQQ"]')!.click());
    expect(host.querySelector('button[aria-label="Remove QQQ"]')).toBeNull();
  });
});
