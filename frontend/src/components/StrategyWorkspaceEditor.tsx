import { isCanonicalV2 } from "../domain/canonicalV2";
import type { ResearchContext } from "../domain/researchContext";
import type { StrategyExample } from "../domain/examples";
import type { EditorBootstrap } from "../domain/canonical";
import type { StrategyDetail, StrategyDetailV1, StrategyDetailV2 } from "../strategyApi";
import { StrategyEditor } from "../StrategyEditor";
import { StrategyEditorProvider } from "../store/editorStore";
import { V2StrategyWorkspace } from "./V2StrategyWorkspace";

export function StrategyWorkspaceEditor({ bootstrap, example, detail, surface, initialView = "overview", confirmation, sourceFocus, onDirtyChange, onOpenStrategy, onOpenBuilder, onOpenResearch, onOpenRun }: {
  bootstrap: EditorBootstrap;
  example: StrategyExample;
  detail: StrategyDetail;
  surface: "detail" | "builder" | "research";
  initialView?: "overview" | "guided";
  confirmation?: string | null;
  sourceFocus?: { revisionId: string; componentId: string; fieldPath?: string | null; researchContext?: ResearchContext } | null;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenStrategy: () => void;
  onOpenBuilder: () => void;
  onOpenResearch: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const canonical = detail.current_revision.canonical_strategy;
  if (isCanonicalV2(canonical)) {
    return <V2StrategyWorkspace
      key={detail.strategy.id}
      detail={detail as StrategyDetailV2}
      surface={surface}
      onDirtyChange={onDirtyChange}
      onOpenStrategy={onOpenStrategy}
      onOpenBuilder={onOpenBuilder}
      onOpenResearch={onOpenResearch}
      onOpenRun={onOpenRun}
    />;
  }
  if (surface !== "builder") {
    return <main className="page strategy-object-page"><span className="eyebrow">Compatibility strategy</span><h1>{detail.strategy.name}</h1><p>This saved V1 strategy remains available for its narrow Candidate workflow.</p><div className="dialog-actions"><button className="secondary-button" onClick={onOpenResearch}>Open saved research</button><button className="primary-button" onClick={onOpenBuilder}>Edit in Builder</button></div></main>;
  }
  return <StrategyEditorProvider key={detail.current_revision.id} bootstrap={bootstrap} initialView={initialView}>
    <StrategyEditor example={example} persisted={detail as StrategyDetailV1} confirmation={confirmation} onDirtyChange={onDirtyChange} onHome={onOpenStrategy} sourceFocus={sourceFocus} />
  </StrategyEditorProvider>;
}
