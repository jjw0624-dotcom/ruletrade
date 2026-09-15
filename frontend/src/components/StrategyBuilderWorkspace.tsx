import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import type { ConceptualFlowProjection } from "../domain/conceptualFlow";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor, type EditorView } from "../store/editorStore";
import { FlowView } from "../views/FlowView";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { SemanticInspector } from "./SemanticInspector";
import { WorkspaceResearchRail, WorkspaceResearchSurface } from "./WorkspaceDashboard";
import { WorkspaceLeftPanel } from "./WorkspaceLeftPanel";

const representationLabel: Record<EditorView, string> = {
  overview: "Summary",
  guided: "Guide",
  flow: "Flow",
};

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
    open: boolean;
    size: number;
    title: string;
    hasActivity: boolean;
    content: ReactNode;
    onToggle: () => void;
    onHistory: () => void;
    onResize: (size: number) => void;
  };
  onHome: () => void;
  onRename: () => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const { state, dispatch } = useStrategyEditor();
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
    <PanelGroup className="builder-workbench" direction="horizontal" onLayout={(sizes) => { if (research?.open && sizes[1] !== undefined) research.onResize(sizes[1]); }}>
      <Panel id="builder" order={1} defaultSize={research?.open ? 100 - research.size : 100} minSize={30}>
        <div className={`builder-core${state.editor.leftPanelOpen ? " left-open" : ""}${state.editor.selection ? " inspector-open" : ""}`}>
          <WorkspaceLeftPanel projection={projection} structural={structural} />
          <main className="representation-workspace" aria-label={`${representationLabel[state.editor.activeView]} representation`}>
            <section hidden={state.editor.activeView !== "overview"} className="representation-layer"><OverviewView onTest={onTest} /></section>
            <section hidden={state.editor.activeView !== "guided"} className="representation-layer"><GuidedView /></section>
            <section hidden={state.editor.activeView !== "flow"} className="representation-layer flow-layer"><FlowView structural={structural} /></section>
          </main>
          <SemanticInspector projection={projection} structural={structural} evidence={inspectorEvidence} />
          {persisted && research && !research.open && <WorkspaceResearchRail open={false} hasActivity={research.hasActivity} onToggle={research.onToggle} />}
        </div>
      </Panel>
      {research?.open && <>
        <PanelResizeHandle className="research-resize-handle"><span /></PanelResizeHandle>
        <Panel id="research" order={2} defaultSize={research.size} minSize={28} maxSize={70}>
          <WorkspaceResearchSurface title={research.title} onClose={research.onToggle} onHistory={research.onHistory}>{research.content}</WorkspaceResearchSurface>
        </Panel>
      </>}
    </PanelGroup>
  </section>;
}
