import { useState } from "react";

import { catalogBaseFromStrategy } from "../researchExperimentApi";
import type { StrategyDetailV2 } from "../strategyApi";
import { DetailBtDialog } from "./DetailBtDialog";
import { ForwardExperimentDialog } from "./ForwardExperimentDialog";
import { HiddenBtDialog } from "./HiddenBtDialog";
import { ResearchTestsDialog } from "./ResearchTestsDialog";
import { StrategyResearchHub } from "./StrategyResearchHub";
import { V2StrategyEditor } from "./V2StrategyEditor";

type ResearchAction = "detail" | "hidden" | "tests" | "forward";
type StrategySurface = "detail" | "builder" | "research";

export function V2StrategyWorkspace({ detail, surface, onDirtyChange, onOpenStrategy, onOpenBuilder, onOpenResearch, onOpenRun }: {
  detail: StrategyDetailV2;
  surface: StrategySurface;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenStrategy: () => void;
  onOpenBuilder: () => void;
  onOpenResearch: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const [researchAction, setResearchAction] = useState<ResearchAction | null>(null);
  const [savedExperiment, setSavedExperiment] = useState<{ kind: "detail" | "hidden" | "tests"; id: string } | null>(null);
  const canonical = detail.current_revision.canonical_strategy;
  const revisionId = detail.current_revision.id;
  const program = canonical.program;
  const statementCount = program?.statements.length ?? 0;
  const groupCount = canonical.definitions.groups.length;
  const assetCount = canonical.definitions.asset_sets.reduce((total, item) => total + item.assets.length, 0);

  if (surface === "builder") {
    return <V2StrategyEditor
      key={revisionId}
      persisted={detail}
      onDirtyChange={onDirtyChange}
      onHome={onOpenStrategy}
      onOpenRun={onOpenRun}
    />;
  }

  if (surface === "research") {
    return <main aria-label="Strategy research portfolio">
      <StrategyResearchHub
        presentation="page"
        strategyId={detail.strategy.id}
        currentRevisionId={revisionId}
        onClose={onOpenStrategy}
        onStart={(action) => { setSavedExperiment(null); setResearchAction(action); }}
        onOpenRun={onOpenRun}
        onOpenDetail={(id) => { setSavedExperiment({ kind: "detail", id }); setResearchAction("detail"); }}
        onOpenHidden={(id) => { setSavedExperiment({ kind: "hidden", id }); setResearchAction("hidden"); }}
        onOpenTest={(id) => { setSavedExperiment({ kind: "tests", id }); setResearchAction("tests"); }}
      />
      {researchAction === "detail" && <DetailBtDialog revisionId={revisionId} base={catalogBaseFromStrategy(canonical)} experimentId={savedExperiment?.kind === "detail" ? savedExperiment.id : null} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
      {researchAction === "hidden" && <HiddenBtDialog revisionId={revisionId} base={catalogBaseFromStrategy(canonical)} experimentId={savedExperiment?.kind === "hidden" ? savedExperiment.id : null} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
      {researchAction === "tests" && <ResearchTestsDialog revisionId={revisionId} base={catalogBaseFromStrategy(canonical)} experimentId={savedExperiment?.kind === "tests" ? savedExperiment.id : null} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
      {researchAction === "forward" && <ForwardExperimentDialog revisionId={revisionId} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
    </main>;
  }

  return <main className="page strategy-object-page" aria-label="Strategy detail">
    <header className="page-header">
      <button type="button" className="text-button" onClick={() => window.history.back()}>← My Strategies</button>
      <div><span className="eyebrow">Saved strategy</span><h1>{detail.strategy.name}</h1><p>{canonical.metadata.description || "A versioned strategy ready for Builder editing and reproducible research."}</p></div>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onOpenResearch}>Research</button>
        <button type="button" className="primary-button" onClick={onOpenBuilder}>Edit in Builder</button>
      </div>
    </header>

    <section className="result-hero" aria-label="Current strategy revision">
      <div><span className="eyebrow">Current Revision</span><h2>{revisionId.slice(0, 8)}…</h2><p>Saved {new Date(detail.current_revision.created_at).toLocaleString()} · source {detail.current_revision.source_hash.slice(0, 12)}…</p></div>
      <span className="status-badge success">Saved</span>
    </section>

    <section className="strategy-cards" aria-label="Strategy summary">
      <article className="strategy-card"><span className="eyebrow">Meaning</span><strong>{statementCount} program statements</strong><p>Canonical V2 meaning is shared by every Builder representation.</p></article>
      <article className="strategy-card"><span className="eyebrow">Universe</span><strong>{assetCount} assets · {groupCount} groups</strong><p>Reusable definitions remain separate from the execution program.</p></article>
      <button type="button" className="strategy-card" onClick={onOpenBuilder}><span className="eyebrow">Builder</span><strong>Edit and Quick Test</strong><p>Create the strategy like a Figma design. Builder contains Save and fast Test only.</p></button>
      <button type="button" className="strategy-card" onClick={onOpenResearch}><span className="eyebrow">Research</span><strong>Evaluate saved Revisions</strong><p>Detail BT, Hidden BT, Tests, Forward, and immutable evidence live here.</p></button>
    </section>

    <section className="empty-state">
      <h2>One strategy, separate workspaces</h2>
      <p>Builder authors the design. Research evaluates saved versions. Learning and Competitions submit those versions from their own problem pages.</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onOpenResearch}>Open Research</button><button type="button" className="primary-button" onClick={onOpenBuilder}>Open Builder</button></div>
    </section>
  </main>;
}
