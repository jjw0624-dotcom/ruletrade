import type { ReactNode } from "react";

import type { BacktestRunRecord } from "../backtestRunApi";
import type { ConceptualFlowProjection } from "../domain/conceptualFlow";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor, type EditorView } from "../store/editorStore";
import { FlowView } from "../views/FlowView";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { SemanticInspector } from "./SemanticInspector";
import { WorkspaceDashboard } from "./WorkspaceDashboard";
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
  revisionId,
  projection,
  structural,
  runs,
  runsStatus,
  inspectorEvidence,
  notices,
  validation,
  researchLayer,
  onHome,
  onRename,
  onSave,
  onTest,
  onOpenRun,
}: {
  name: string;
  dirty: boolean;
  saving: boolean;
  persisted: boolean;
  revisionId: string | null;
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
  runs: BacktestRunRecord[];
  runsStatus: "loading" | "loaded" | "error";
  inspectorEvidence?: ReactNode;
  notices?: ReactNode;
  validation?: ReactNode;
  researchLayer?: ReactNode;
  onHome: () => void;
  onRename: () => void;
  onSave: () => void;
  onTest: () => void;
  onOpenRun?: (runId: string) => void;
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
    <div className={`builder-workbench${state.editor.leftPanelOpen ? " left-open" : ""}${state.editor.selection ? " inspector-open" : ""}${state.editor.dashboardOpen ? " dashboard-open" : ""}`}>
      <WorkspaceLeftPanel projection={projection} structural={structural} />
      <main className="representation-workspace" aria-label={`${representationLabel[state.editor.activeView]} representation`}>
        <section hidden={state.editor.activeView !== "overview"} className="representation-layer"><OverviewView onTest={onTest} /></section>
        <section hidden={state.editor.activeView !== "guided"} className="representation-layer"><GuidedView /></section>
        <section hidden={state.editor.activeView !== "flow"} className="representation-layer flow-layer"><FlowView structural={structural} /></section>
      </main>
      <SemanticInspector projection={projection} structural={structural} evidence={inspectorEvidence} />
      {persisted && <WorkspaceDashboard revisionId={revisionId} runs={runs} status={runsStatus} onOpenRun={onOpenRun} />}
      {researchLayer && <aside className="workspace-research-layer">{researchLayer}</aside>}
    </div>
  </section>;
}
