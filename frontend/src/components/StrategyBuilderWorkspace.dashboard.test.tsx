// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StrategyBuilderWorkspace, type ProgramBuilderContract, type ProgramBuilderView } from "./StrategyBuilderWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const views: ProgramBuilderView[] = ["overview", "guided", "flow", "blocky", "rules", "code", "ai"];
const representations = Object.fromEntries(views.map((view) => [view, <div key={view}>{view}</div>])) as ProgramBuilderContract["representations"];

function program(): ProgramBuilderContract {
  return {
    activeView: "blocky", onViewChange: () => undefined,
    leftPanel: <aside>Left</aside>, representations,
    inspector: <div>Inspector</div>, inspectorOpen: false, onCloseInspector: () => undefined,
    feedback: null, draftMessage: null,
    onUndo: () => undefined, onRedo: () => undefined, canUndo: false, canRedo: false,
    detailPanel: { title: "Quick Test Dashboard", content: <input aria-label="Selected result context" defaultValue="run-2" />, onClose: () => undefined },
  };
}

describe("Quick Test Dashboard overlay", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

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
});
