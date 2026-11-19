import { useState } from "react";

import { catalogBaseFromStrategy } from "../researchExperimentApi";
import { strategyApi, type StrategyDetailV2 } from "../strategyApi";
import { DetailBtDialog } from "./DetailBtDialog";
import { ForwardExperimentDialog } from "./ForwardExperimentDialog";
import { HiddenBtDialog } from "./HiddenBtDialog";
import { ResearchTestsDialog } from "./ResearchTestsDialog";
import { StrategyResearchHub } from "./StrategyResearchHub";
import { V2StrategyEditor } from "./V2StrategyEditor";

type ResearchAction = "detail" | "hidden" | "tests" | "forward";

export function V2StrategyWorkspace({ detail, onDirtyChange, onHome, onOpenRun }: {
  detail: StrategyDetailV2;
  onDirtyChange?: (dirty: boolean) => void;
  onHome: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const [current, setCurrent] = useState(detail);
  const [surface, setSurface] = useState<"overview" | "builder">("overview");
  const [dirty, setDirty] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchAction, setResearchAction] = useState<ResearchAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canonical = current.current_revision.canonical_strategy;
  const revisionId = current.current_revision.id;
  const program = canonical.program;
  const statementCount = program?.statements.length ?? 0;
  const groupCount = canonical.definitions.groups.length;
  const assetCount = canonical.definitions.asset_sets.reduce((total, item) => total + item.symbols.length, 0);

  const handleDirty = (value: boolean) => {
    setDirty(value);
    onDirtyChange?.(value);
  };

  const returnToOverview = async () => {
    if (dirty && !window.confirm("Discard unsaved Builder changes and return to the Strategy?")) return;
    setRefreshing(true);
    try {
      const latest = await strategyApi.get(current.strategy.id);
      if (latest.current_revision.canonical_strategy.api_version === "ruletrade.dev/strategy/v2") {
        setCurrent(latest as StrategyDetailV2);
      }
      handleDirty(false);
      setSurface("overview");
    } finally {
      setRefreshing(false);
    }
  };

  const startResearch = (action: ResearchAction) => {
    setResearchOpen(false);
    setResearchAction(action);
  };

  if (surface === "builder") {
    return <V2StrategyEditor
      key={revisionId}
      persisted={current}
      onDirtyChange={handleDirty}
      onHome={() => void returnToOverview()}
      onOpenRun={onOpenRun}
    />;
  }

  return <main className="page strategy-object-page" aria-label="Strategy detail">
    <header className="page-header">
      <button type="button" className="text-button" onClick={onHome}>← My Strategies</button>
      <div><span className="eyebrow">Saved strategy</span><h1>{current.strategy.name}</h1><p>{canonical.metadata.description || "A versioned strategy ready for Builder editing and reproducible research."}</p></div>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={() => setResearchOpen(true)}>Research</button>
        <button type="button" className="primary-button" onClick={() => setSurface("builder")} disabled={refreshing}>{refreshing ? "Refreshing…" : "Edit in Builder"}</button>
      </div>
    </header>

    <section className="result-hero" aria-label="Current strategy revision">
      <div><span className="eyebrow">Current Revision</span><h2>{revisionId.slice(0, 8)}…</h2><p>Saved {new Date(current.current_revision.created_at).toLocaleString()} · source {current.current_revision.source_hash.slice(0, 12)}…</p></div>
      <span className="status-badge success">Saved</span>
    </section>

    <section className="strategy-cards" aria-label="Strategy summary">
      <article className="strategy-card"><span className="eyebrow">Meaning</span><strong>{statementCount} program statements</strong><p>Canonical V2 meaning is the source shared by every Builder representation.</p></article>
      <article className="strategy-card"><span className="eyebrow">Universe</span><strong>{assetCount} assets · {groupCount} groups</strong><p>Reusable definitions remain separate from the strategy's execution program.</p></article>
      <article className="strategy-card"><span className="eyebrow">Quick feedback</span><strong>Quick Test in Builder</strong><p>Use it while editing. Durable comparisons and holdouts belong in Research.</p></article>
      <button type="button" className="strategy-card" onClick={() => setResearchOpen(true)}><span className="eyebrow">Evaluation</span><strong>Open Research</strong><p>Detail BT, Hidden BT, Tests, Forward, and saved evidence across Revisions.</p></button>
    </section>

    <section className="empty-state">
      <h2>Strategy first, tools second</h2>
      <p>This page is the durable Strategy object. Builder edits its current meaning; Research evaluates saved Revisions without rewriting historical evidence.</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setResearchOpen(true)}>View Research</button><button type="button" className="primary-button" onClick={() => setSurface("builder")}>Open Builder</button></div>
    </section>

    {researchOpen && <StrategyResearchHub strategyId={current.strategy.id} currentRevisionId={revisionId} onClose={() => setResearchOpen(false)} onStart={startResearch} onOpenRun={onOpenRun} />}
    {researchAction === "detail" && <DetailBtDialog revisionId={revisionId} base={catalogBaseFromStrategy(canonical)} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
    {researchAction === "hidden" && <HiddenBtDialog revisionId={revisionId} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
    {researchAction === "tests" && <ResearchTestsDialog revisionId={revisionId} base={catalogBaseFromStrategy(canonical)} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
    {researchAction === "forward" && <ForwardExperimentDialog revisionId={revisionId} onClose={() => setResearchAction(null)} onOpenRun={onOpenRun} />}
  </main>;
}
