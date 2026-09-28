import { lazy, Suspense, useState, type PointerEvent, type ReactNode } from "react";

import type { ConceptualFlowProjection } from "../domain/conceptualFlow";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor, type EditorView } from "../store/editorStore";
import { FlowView } from "../views/FlowView";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { SemanticInspector } from "./SemanticInspector";
import { WorkspaceActivityDrawer, WorkspaceEdgeRail, WorkspaceResearchSurface } from "./WorkspaceDashboard";
import { WorkspaceLeftPanel } from "./WorkspaceLeftPanel";
import { RulesView } from "../views/RulesView";
import { CodeView } from "../views/CodeView";
import { AIHandoffView } from "../views/AIHandoffView";

const BlockyView = lazy(() => import("../views/BlockyView").then((module) => ({ default: module.BlockyView })));

const representationLabel: Record<EditorView, string> = {
  overview: "Summary",
  guided: "Guide",
  flow: "Flow",
  blocky: "Blocky",
  rules: "Rules",
  code: "Code",
  ai: "AI",
};

export function shouldShowSemanticInspector(hasSelection: boolean, researchOpen: boolean): boolean {
  return hasSelection && !researchOpen;
}

export type InteractionFamily = "composer" | "structured" | "document";
export function interactionFamily(view: EditorView): InteractionFamily {
  if (view === "flow" || view === "blocky") return "composer";
  if (view === "guided" || view === "rules") return "structured";
  return "document";
}

export function shouldStoreResearchSize(size: number | undefined, isUserInteraction: boolean): size is number {
  return isUserInteraction && size !== undefined && Number.isFinite(size);
}

export function StrategyBuilderWorkspace({
  name,
  dirty,
  saving,
  persisted,
  projection,
  structural,
  inspectorEvidence,
  notices,
  validation,
  research,
  onHome,
  onRename,
  onSave,
  onTest,
  revisionId,
  researchContext,
}: {
  name: string;
  dirty: boolean;
  saving: boolean;
  persisted: boolean;
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
  inspectorEvidence?: ReactNode;
  notices?: ReactNode;
  validation?: ReactNode;
  research?: {
    activityOpen: boolean;
    researchOpen: boolean;
    canOpenResearch: boolean;
    size: number;
    title: string;
    hasActivity: boolean;
    content: ReactNode;
    activity: ReactNode;
    onToggleActivity: () => void;
    onToggleResearch: () => void;
    onResize: (size: number) => void;
  };
  onHome: () => void;
  onRename: () => void;
  onSave: () => void;
  onTest: () => void;
  revisionId?: string | null;
  researchContext?: { runId: string; sessionId: string; asset: string | null } | null;
}) {
  const { state, dispatch } = useStrategyEditor();
  const [blockyVisited, setBlockyVisited] = useState(state.editor.activeView === "blocky");
  const family = interactionFamily(state.editor.activeView);
  const showContext = family !== "document";
  const showInspector = family !== "document" && shouldShowSemanticInspector(Boolean(state.editor.selection), Boolean(research?.researchOpen));
  const switchView = (view: EditorView) => { if (view === "blocky") setBlockyVisited(true); dispatch({ type: "set_active_view", view }); };
  const beginResearchResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!research) return;
    const surface = event.currentTarget.parentElement;
    const workbench = surface?.parentElement;
    if (!surface || !workbench) return;
    const bounds = workbench.getBoundingClientRect();
    const move = (pointer: globalThis.PointerEvent) => research.onResize(((bounds.right - pointer.clientX) / bounds.width) * 100);
    const finish = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", finish); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish, { once: true });
    event.preventDefault();
  };
  const builder = <div data-interaction-family={family} className={`builder-core active-${state.editor.activeView}${showContext && state.editor.leftPanelOpen ? " left-open" : ""}${showInspector ? " inspector-open" : ""}${!showContext ? " content-wide" : ""}`}>
    {showContext && <WorkspaceLeftPanel projection={projection} structural={structural} />}
    <main className="representation-workspace" aria-label={`${representationLabel[state.editor.activeView]} representation`}>
      <section hidden={state.editor.activeView !== "overview"} className="representation-layer"><OverviewView onTest={onTest} /></section>
      <section hidden={state.editor.activeView !== "guided"} className="representation-layer"><GuidedView structural={structural} /></section>
      <section hidden={state.editor.activeView !== "flow"} className="representation-layer flow-layer"><FlowView structural={structural} /></section>
      {blockyVisited && <section hidden={state.editor.activeView !== "blocky"} className="representation-layer blocky-layer"><Suspense fallback={<p role="status">Loading logic editor…</p>}><BlockyView structural={structural} /></Suspense></section>}
      <section hidden={state.editor.activeView !== "rules"} className="representation-layer"><RulesView structural={structural} /></section>
      <section hidden={state.editor.activeView !== "code"} className="representation-layer"><CodeView /></section>
      <section hidden={state.editor.activeView !== "ai"} className="representation-layer"><AIHandoffView structural={structural} revisionId={revisionId ?? null} researchContext={researchContext ?? null} /></section>
    </main>
    {showInspector && <SemanticInspector projection={projection} structural={structural} evidence={inspectorEvidence} />}
  </div>;
  return <section className="strategy-builder-workspace">
    <header className="builder-chrome">
      <button className="builder-brand" aria-label="Back to Home" onClick={onHome}><span className="brand-mark">R</span></button>
      <div className="representation-switcher" aria-label="Strategy representation">
        {(Object.keys(representationLabel) as EditorView[]).map((view) => <button key={view} aria-pressed={state.editor.activeView === view} className={state.editor.activeView === view ? "active" : ""} onClick={() => switchView(view)}>{representationLabel[view]}</button>)}
      </div>
      <button className="builder-identity" onClick={onRename} disabled={!persisted}><strong>{name}</strong><small>{dirty ? "Unsaved changes" : persisted ? "Saved" : "Preview"}</small></button>
      <div className="builder-actions">
        {persisted && <button className="secondary-button" onClick={onSave} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button>}
        <button className="primary-button" onClick={onTest}>Test <span aria-hidden="true">▶</span></button>
      </div>
    </header>
    <div className="builder-messages">{notices}{validation}</div>
    {research?.researchOpen ? <div className="builder-workbench" data-research-open data-research-layout="overlay">
      {builder}
      <aside className="research-overlay" style={{ width: `${research.size}%` }}>
        <div className="research-resize-handle" role="separator" aria-label="Resize Research" aria-orientation="vertical" onPointerDown={beginResearchResize}><span /></div>
        <WorkspaceResearchSurface title={research.title} onClose={research.onToggleResearch}>{research.content}</WorkspaceResearchSurface>
      </aside>
    </div> : <div className="builder-workbench builder-only" data-research-layout="builder-only">{builder}</div>}
    {persisted && research && <WorkspaceEdgeRail activityOpen={research.activityOpen} researchOpen={research.researchOpen} canOpenResearch={research.canOpenResearch} hasActivity={research.hasActivity} onToggleActivity={research.onToggleActivity} onToggleResearch={research.onToggleResearch} />}
    {persisted && research?.activityOpen && <WorkspaceActivityDrawer onClose={research.onToggleActivity}>{research.activity}</WorkspaceActivityDrawer>}
  </section>;
}
