// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StrategyBuilderWorkspace, type ProgramBuilderContract, type ProgramBuilderView } from "./StrategyBuilderWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const views: ProgramBuilderView[] = ["overview", "guided", "flow", "blocky", "rules", "code", "ai"];
const representations = Object.fromEntries(views.map((view) => [view, <div key={view}>{view}</div>])) as ProgramBuilderContract["representations"];

function program(detailPanel: ProgramBuilderContract["detailPanel"] = { title: "Quick Test Dashboard", content: <input aria-label="Selected result context" defaultValue="run-2" />, onClose: () => undefined }): ProgramBuilderContract {
  return {
    activeView: "blocky", onViewChange: () => undefined,
    leftPanel: <aside>Left</aside>, representations,
    inspector: <div>Inspector</div>, inspectorOpen: false, onCloseInspector: () => undefined,
    feedback: null, draftMessage: null,
    onUndo: () => undefined, onRedo: () => undefined, canUndo: false, canRedo: false,
    detailPanel,
  };
}

describe("Quick Test Dashboard overlay", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("gives a dedicated object workspace ownership of the whole workbench", async () => {
    const contract = program();
    contract.detailPanel = null;
    contract.workspaceOverlay = <section aria-label="Group Workspace">Group editor</section>;
    await act(async () => root.render(<StrategyBuilderWorkspace program={contract} name="Strategy" dirty={false} saving={false} persisted onHome={() => undefined} onSave={() => undefined} onTest={() => undefined} />));

    const core = container.querySelector<HTMLElement>(".program-builder-core")!;
    const workspace = container.querySelector<HTMLElement>('[aria-label="Group Workspace"]')!;
    expect(core.getAttribute("aria-hidden")).toBe("true");
    expect(core.hasAttribute("inert")).toBe(true);
    expect(workspace.parentElement?.classList.contains("builder-workbench")).toBe(true);
    expect(workspace.parentElement).toBe(core.parentElement);
  });

  it("overlays the Builder without adding an Inspector grid column and preserves context while collapsed", async () => {
    await act(async () => root.render(<StrategyBuilderWorkspace program={program()} name="Strategy" dirty={false} saving={false} persisted onHome={() => undefined} onSave={() => undefined} onTest={() => undefined} />));
    const core = container.querySelector(".program-builder-core")!;
    const dashboard = container.querySelector<HTMLElement>('[aria-label="Quick Test Dashboard"]')!;
    const context = container.querySelector<HTMLInputElement>('[aria-label="Selected result context"]')!;
    context.value = "decision-7";

    expect(core.classList.contains("inspector-open")).toBe(false);
    expect(dashboard.parentElement?.classList.contains("builder-workbench")).toBe(true);
    expect(dashboard.parentElement).toBe(core.parentElement);
    expect(dashboard.dataset.dashboardState).toBe("open");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse Quick Test Dashboard"]')!.click());
    expect(dashboard.dataset.dashboardState).toBe("collapsed");
    expect(container.querySelector('[aria-label="Reopen Quick Test Dashboard"]')).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Reopen Quick Test Dashboard"]')!.click());
    expect(dashboard.dataset.dashboardState).toBe("open");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Selected result context"]')?.value).toBe("decision-7");
  });

  it("retains at most three saved Runs and restores each mounted result context", async () => {
    const renderRun = async (id: string) => act(async () => root.render(<StrategyBuilderWorkspace program={program({ id: `run:${id}`, title: "Quick Test Dashboard", bookmarkLabel: `Run ${id}`, retainInHistory: true, content: <input aria-label={`Context ${id}`} defaultValue={id} />, onClose: () => undefined })} name="Strategy" dirty={false} saving={false} persisted onHome={() => undefined} onSave={() => undefined} onTest={() => undefined} />));
    await renderRun("1");
    container.querySelector<HTMLInputElement>('[aria-label="Context 1"]')!.value = "decision-1";
    await renderRun("2"); await renderRun("3"); await renderRun("4");

    expect(container.querySelector('[aria-label="Open Run 1"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label="Recent Quick Test results"] button')).toHaveLength(3);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open Run 2"]')!.click());
    expect(container.querySelector<HTMLElement>('[data-quick-test-result="run:2"]')?.hidden).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open Run 4"]')!.click());
    expect(container.querySelector<HTMLElement>('[data-quick-test-result="run:4"]')?.hidden).toBe(false);
  });

  it("does not keep setup or failure panels in recent result bookmarks", async () => {
    await act(async () => root.render(<StrategyBuilderWorkspace program={program({ id: "setup", title: "Quick Test Dashboard", content: <div>Setup</div>, onClose: () => undefined })} name="Strategy" dirty={false} saving={false} persisted onHome={() => undefined} onSave={() => undefined} onTest={() => undefined} />));
    expect(container.querySelector('[aria-label="Recent Quick Test results"]')).toBeNull();
  });

});
