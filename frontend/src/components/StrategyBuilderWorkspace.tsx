import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import type { ConceptualFlowProjection } from "../domain/conceptualFlow";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor, type EditorView } from "../store/editorStore";
import { FlowView } from "../views/FlowView";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { SemanticInspector } from "./SemanticInspector";
import { WorkspaceActivityDrawer, WorkspaceEdgeRail, WorkspaceResearchSurface } from "./WorkspaceDashboard";
import { WorkspaceLeftPanel } from "./WorkspaceLeftPanel";

const representationLabel: Record<EditorView, string> = {
  overview: "Summary",
  guided: "Guide",
  flow: "Flow",
};

export function shouldShowSemanticInspector(hasSelection: boolean, researchOpen: boolean): boolean {
  return hasSelection && !researchOpen;
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
}) {
  const { state, dispatch } = useStrategyEditor();
  const showInspector = shouldShowSemanticInspector(Boolean(state.editor.selection), Boolean(research?.researchOpen));
  const switchView = (view: EditorView) => dispatch({ type: "set_active_view", view });
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
    {notices}
    {validation}
    <Group className="builder-workbench" data-research-open={research?.researchOpen || undefined} orientation="horizontal" onLayoutChanged={(layout) => { if (research?.researchOpen && layout.research !== undefined) research.onResize(layout.research); }}>
      <Panel id="builder" defaultSize={`${research?.researchOpen ? 100 - research.size : 100}%`} minSize="15%">
        <div className={`builder-core${state.editor.leftPanelOpen ? " left-open" : ""}${showInspector ? " inspector-open" : ""}`}>
          <WorkspaceLeftPanel projection={projection} structural={structural} />
          <main className="representation-workspace" aria-label={`${representationLabel[state.editor.activeView]} representation`}>
            <section hidden={state.editor.activeView !== "overview"} className="representation-layer"><OverviewView onTest={onTest} /></section>
            <section hidden={state.editor.activeView !== "guided"} className="representation-layer"><GuidedView /></section>
            <section hidden={state.editor.activeView !== "flow"} className="representation-layer flow-layer"><FlowView structural={structural} /></section>
          </main>
          {showInspector && <SemanticInspector projection={projection} structural={structural} evidence={inspectorEvidence} />}
        </div>
      </Panel>
      {research?.researchOpen && <>
        <Separator className="research-resize-handle"><span /></Separator>
        <Panel id="research" defaultSize={`${research.size}%`} minSize="45%" maxSize="85%">
          <WorkspaceResearchSurface title={research.title} onClose={research.onToggleResearch}>{research.content}</WorkspaceResearchSurface>
        </Panel>
      </>}
    </Group>
    {persisted && research && <WorkspaceEdgeRail activityOpen={research.activityOpen} researchOpen={research.researchOpen} canOpenResearch={research.canOpenResearch} hasActivity={research.hasActivity} onToggleActivity={research.onToggleActivity} onToggleResearch={research.onToggleResearch} />}
    {persisted && research?.activityOpen && <WorkspaceActivityDrawer onClose={research.onToggleActivity}>{research.activity}</WorkspaceActivityDrawer>}
  </section>;
}
