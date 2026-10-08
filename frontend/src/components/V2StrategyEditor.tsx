import { useEffect, useRef, useState } from "react";
import type { V2AuthoringOperation } from "../domain/canonicalV2";
import { describeConditionV2, describeDailyValue } from "../domain/v2Semantics";
import type { StrategyDetailV2 } from "../strategyApi";
import { strategyApi } from "../strategyApi";
import { v2AuthoringApi } from "../v2AuthoringApi";
import { executeV2Selection, type V2SelectionExecution } from "../v2ExecutionApi";
import { V2ConditionComposer, V2ValueComposer } from "./V2SemanticComposer";

type View = "summary" | "flow" | "blocky" | "rules";

export function V2StrategyEditor({ persisted, onHome, onDirtyChange }: {
  persisted: StrategyDetailV2;
  onHome: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initial = persisted.current_revision.canonical_strategy;
  const [canonical, setCanonical] = useState(initial);
  const [revisionId, setRevisionId] = useState(persisted.current_revision.id);
  const [sourceHash, setSourceHash] = useState(persisted.current_revision.source_hash);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<View>("summary");
  const [status, setStatus] = useState<"saved" | "updating" | "invalid" | "unfinished">("saved");
  const [message, setMessage] = useState("Saved");
  const [result, setResult] = useState<V2SelectionExecution | null>(null);
  const sequence = useRef(0);
  const unavailable = status === "unfinished" || status === "invalid" || status === "updating";
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  if (canonical.selection === null) {
    return <section className="strategy-builder-workspace v2-program-workspace" data-canonical-version="v2">
      <header className="builder-chrome">
        <button className="builder-brand" aria-label="Back to Home" onClick={onHome}><span className="brand-mark">R</span></button>
        <div className="builder-identity"><strong>{persisted.strategy.name}</strong><small>Semantic Program Core</small></div>
        <div className="builder-actions"><button className="secondary-button" disabled>Save</button><button className="primary-button" disabled>Test ▶</button></div>
      </header>
      <main className="representation-workspace">
        <section className="representation-layer v2-summary">
          <span className="eyebrow">Profile A · Semantic Program Core</span>
          <h1>{canonical.metadata.name}</h1>
          <p>{canonical.program?.statements.length ?? 0} typed Program statements are preserved in this revision.</p>
          <p>Generalized Program authoring is intentionally deferred until the core contract is accepted.</p>
        </section>
      </main>
    </section>;
  }

  const apply = async (operation: V2AuthoringOperation) => {
    const request = ++sequence.current;
    setStatus("updating"); setMessage("Updating…");
    try {
      const response = await v2AuthoringApi.apply(canonical, sourceHash, operation);
      if (request !== sequence.current) return;
      setCanonical(response.strategy);
      setSourceHash(response.source_hash);
      setDirty(true);
      setStatus("saved"); setMessage("Updated");
    } catch (reason) {
      if (request !== sequence.current) return;
      setStatus("invalid");
      setMessage(reason instanceof Error ? reason.message : "This semantic edit is invalid.");
    }
  };
  const save = async () => {
    if (!dirty || status !== "saved") return;
    setStatus("updating"); setMessage("Saving revision…");
    try {
      const response = await strategyApi.save(persisted.strategy.id, revisionId, canonical);
      setCanonical(response.revision.canonical_strategy);
      setRevisionId(response.revision.id);
      setSourceHash(response.revision.source_hash);
      setDirty(false); setStatus("saved"); setMessage("Saved");
    } catch (reason) {
      setStatus("invalid"); setMessage(reason instanceof Error ? reason.message : "Save failed.");
    }
  };
  const run = async () => {
    if (unavailable) return;
    setStatus("updating"); setMessage("Testing typed v2 Selection…");
    try {
      const next = await executeV2Selection(canonical);
      setResult(next); setStatus("saved"); setMessage("Test complete");
    } catch (reason) {
      setStatus("invalid"); setMessage(reason instanceof Error ? reason.message : "Test failed.");
    }
  };
  const universe = canonical.definitions.groups.find((group) => group.id === canonical.selection.universe_id);
  const assetSet = canonical.definitions.asset_sets.find((item) => item.id === (universe?.asset_set_ref ?? canonical.selection.universe_id));

  return <section className="strategy-builder-workspace v2-strategy-workspace" data-canonical-version="v2">
    <header className="builder-chrome">
      <button className="builder-brand" aria-label="Back to Home" onClick={onHome}><span className="brand-mark">R</span></button>
      <div className="representation-switcher" aria-label="Strategy representation">
        {(["summary", "flow", "blocky", "rules"] as View[]).map((item) => <button key={item} aria-pressed={view === item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
      </div>
      <div className="builder-identity"><strong>{persisted.strategy.name}</strong><small>{dirty ? "Unsaved changes" : "Saved v2 Strategy"}</small></div>
      <div className="builder-actions"><button className="secondary-button" disabled={!dirty || unavailable} onClick={() => void save()}>Save</button><button className="primary-button" disabled={unavailable} title={unavailable ? message : undefined} onClick={() => void run()}>Test ▶</button></div>
    </header>
    <div className="builder-messages"><div className={`semantic-edit-feedback ${status}`} role="status">{message}</div>{result && <section className="v2-test-result" aria-label="v2 Selection result"><strong>{result.complete ? "Selection complete" : "Selection incomplete"}</strong><p>Selected: {result.selected_assets.join(", ") || "none"}</p><p>Eligible: {result.evidence.eligible_members.length} / {result.evidence.requested_members.length} · Unknown: {result.evidence.unknown_members.length}</p>{result.evidence.fallback_used && <p>Selection fallback used: {result.evidence.fallback_asset}</p>}</section>}</div>
    <div className="builder-core inspector-open">
      <main className="representation-workspace">
        {view === "summary" && <section className="representation-layer v2-summary"><span className="eyebrow">Profile A · Semantic Language v2</span><h1>{canonical.metadata.name}</h1><p>Selection is authored from complete typed Values and persisted as an explicit v2 revision.</p></section>}
        {view === "blocky" && <section className="representation-layer v2-blocky" aria-label="Blocky decision program"><div className="blocky-program-card"><strong>Choose {canonical.selection.count} assets</strong><small>{canonical.selection.eligibility ? describeConditionV2(canonical.selection.eligibility) : "All candidates qualify"}</small><small>{canonical.selection.direction === "descending" ? "Highest" : "Lowest"} {describeDailyValue(canonical.selection.ranking)}</small></div></section>}
        {view === "flow" && <section className="representation-layer v2-flow" aria-label="Flow capital projection"><div className="flow-capital-node">Investment</div><div className="flow-routing-node">Choose {canonical.selection.count} assets</div><div className="flow-capital-node">Selected assets · equal weight</div>{canonical.selection.fallback_asset && <div className="flow-capital-node">Incomplete → {canonical.selection.fallback_asset}</div>}<div className="flow-action-node">Rebalance</div></section>}
        {view === "rules" && <section className="representation-layer v2-rules" aria-label="Rules projection"><h2>Selection</h2><p>Consider {assetSet?.assets.join(", ") ?? universe?.name ?? canonical.selection.universe_id}.</p><p>{canonical.selection.eligibility ? `Keep candidates where ${describeConditionV2(canonical.selection.eligibility)}.` : "All candidates qualify."}</p><p>Rank by {describeDailyValue(canonical.selection.ranking)}, {canonical.selection.direction === "descending" ? "highest" : "lowest"} first.</p><p>Choose {canonical.selection.count}; {canonical.selection.shortage_policy === "require_full" ? "require the full count" : "choose all eligible"}.</p>{canonical.selection.fallback_asset && <p>If Selection is incomplete, use {canonical.selection.fallback_asset}.</p>}</section>}
      </main>
      <aside className="semantic-inspector v2-selection-inspector" aria-label="Semantic Inspector">
        <header><span className="eyebrow">Selection</span></header>
        <div className="semantic-inspector-content">
          <h2>Choose {canonical.selection.count}</h2>
          <section><h3>FROM</h3><label>Static universe<select value={canonical.selection.universe_id} onChange={(event) => void apply({ kind: "set_selection_universe", universe_id: event.target.value })}>{canonical.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{canonical.definitions.asset_sets.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label><p>{assetSet?.assets.join(" · ")}</p></section>
          <section><h3>WHERE</h3>{canonical.selection.eligibility
            ? <V2ConditionComposer condition={canonical.selection.eligibility} strategy={canonical} role="eligibility" onWorking={(unfinished) => { setStatus(unfinished ? "unfinished" : "saved"); setMessage(unfinished ? "Unfinished Value" : "Updated"); }} onChange={(condition) => void apply({ kind: "set_eligibility_condition", condition })} />
            : <p>All candidates qualify</p>}</section>
          <section><h3>ORDER BY</h3><V2ValueComposer value={canonical.selection.ranking} strategy={canonical} role="ranking" onWorking={(unfinished) => { setStatus(unfinished ? "unfinished" : "saved"); setMessage(unfinished ? "Unfinished Value" : "Updated"); }} onChange={(value) => void apply({ kind: "set_ranking_value", value })} /></section>
          <section><h3>DIRECTION</h3><select value={canonical.selection.direction} onChange={(event) => void apply({ kind: "set_ranking_direction", direction: event.target.value as "ascending" | "descending" })}><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></section>
          <section><h3>TAKE</h3><input type="number" min={1} max={100} defaultValue={canonical.selection.count} onBlur={(event) => void apply({ kind: "set_selection_count", count: Number(event.target.value) })} /></section>
          <section><h3>WHEN FEWER QUALIFY</h3><select value={canonical.selection.shortage_policy} onChange={(event) => void apply({ kind: "set_shortage_policy", shortage_policy: event.target.value as "choose_all" | "require_full" })}><option value="require_full">Require full count</option><option value="choose_all">Choose all eligible</option></select></section>
          <section><h3>SELECTION FALLBACK</h3><input aria-label="Fallback asset" defaultValue={canonical.selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => void apply({ kind: "set_selection_fallback", fallback_asset: event.target.value.trim().toUpperCase() || null })} /><p className="value-capability-note">Fallback is distinct from shortage policy and Control OTHERWISE.</p></section>
        </div>
      </aside>
    </div>
  </section>;
}
