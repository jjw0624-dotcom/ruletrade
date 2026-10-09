import { isCanonicalV2 } from "../domain/canonicalV2";
import type { ResearchContext } from "../domain/researchContext";
import type { StrategyExample } from "../domain/examples";
import type { EditorBootstrap } from "../domain/canonical";
import type { StrategyDetail, StrategyDetailV1, StrategyDetailV2 } from "../strategyApi";
import { StrategyEditor } from "../StrategyEditor";
import { StrategyEditorProvider } from "../store/editorStore";
import { V2StrategyEditor } from "./V2StrategyEditor";

/**
 * The only production Strategy -> Builder entry.
 *
 * Canonical version selection is a compatibility concern below this boundary;
 * navigation and product identity never choose a separate Builder.
 */
export function StrategyWorkspaceEditor({ bootstrap, example, detail, initialView = "overview", confirmation, sourceFocus, onDirtyChange, onHome }: {
  bootstrap: EditorBootstrap;
  example: StrategyExample;
  detail: StrategyDetail;
  initialView?: "overview" | "guided";
  confirmation?: string | null;
  sourceFocus?: { revisionId: string; componentId: string; fieldPath?: string | null; researchContext?: ResearchContext } | null;
  onDirtyChange?: (dirty: boolean) => void;
  onHome: () => void;
}) {
  const canonical = detail.current_revision.canonical_strategy;
  if (isCanonicalV2(canonical)) {
    return <V2StrategyEditor key={detail.current_revision.id} persisted={detail as StrategyDetailV2} onDirtyChange={onDirtyChange} onHome={onHome} />;
  }
  return <StrategyEditorProvider key={detail.current_revision.id} bootstrap={bootstrap} initialView={initialView}>
    <StrategyEditor example={example} persisted={detail as StrategyDetailV1} confirmation={confirmation} onDirtyChange={onDirtyChange} onHome={onHome} sourceFocus={sourceFocus} />
  </StrategyEditorProvider>;
}

