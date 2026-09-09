import { useEffect, useState } from "react";
import { validateCanonical } from "./api";
import { BacktestErrorPanel } from "./components/BacktestErrorPanel";
import { BacktestSetup } from "./components/BacktestSetup";
import { ResultWorkspace } from "./components/ResultWorkspace";
import type { BacktestConfig } from "./domain/backtest";
import type { StrategyExample } from "./domain/examples";
import { useBacktestRun } from "./hooks/useBacktestRun";
import { useStrategyEditor, type EditorView } from "./store/editorStore";
import { FlowView } from "./views/FlowView";
import { GuidedView } from "./views/GuidedView";
import { sameCanonicalSnapshot, strategyApi, StrategyApiError, type StrategyDetail } from "./strategyApi";

export function StrategyEditor({ example, persisted, onDirtyChange, onArchived }: { example: StrategyExample; persisted?: StrategyDetail; onDirtyChange?: (dirty: boolean) => void; onArchived?: () => void }) {
  const { state, dispatch } = useStrategyEditor();
  const backtest = useBacktestRun();
  const [config, setConfig] = useState<BacktestConfig>(example.backtestDefaults);
  const [showSetup, setShowSetup] = useState(false);
  const [base, setBase] = useState(persisted?.current_revision ?? null);
  const [strategy, setStrategy] = useState(persisted?.strategy ?? null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "stale">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const dirty = base ? !sameCanonicalSnapshot(state.canonical, base.canonical_strategy) : false;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function save() {
    if (!strategy || !base || !dirty) return;
    setSaveStatus("saving"); setSaveMessage(null);
    try {
      const result = await strategyApi.save(strategy.id, base.id, state.canonical);
      setStrategy(result.strategy); setBase(result.revision); setSaveStatus("saved");
      setSaveMessage(result.created ? "Saved as a new revision." : "Already saved.");
    } catch (reason) {
      if (reason instanceof StrategyApiError && reason.detail.code === "stale_revision") { setSaveStatus("stale"); setSaveMessage("This strategy was updated after you opened it. Your edits are still here."); }
      else { setSaveStatus("error"); setSaveMessage(reason instanceof Error ? reason.message : "We couldn't save this strategy."); }
    }
  }

  async function reloadLatest() {
    if (!strategy || !window.confirm("Reload the latest saved revision? Your unsaved edits will be replaced.")) return;
    try { const latest = await strategyApi.get(strategy.id); setStrategy(latest.strategy); setBase(latest.current_revision); dispatch({ type: "replace_canonical", canonical: latest.current_revision.canonical_strategy }); setSaveStatus("idle"); setSaveMessage(null); }
    catch (reason) { setSaveStatus("error"); setSaveMessage(reason instanceof Error ? reason.message : "We couldn't reload this strategy."); }
  }

  async function rename() {
    if (!strategy) return;
    const name = window.prompt("Strategy name", strategy.name)?.trim();
    if (!name || name === strategy.name) return;
    try { const updated = await strategyApi.rename(strategy.id, name); setStrategy(updated.strategy); }
    catch (reason) { setSaveStatus("error"); setSaveMessage(reason instanceof Error ? reason.message : "We couldn't rename this strategy."); }
  }

  async function archive() {
    if (!strategy || !window.confirm("Archive this strategy? Its revision history will be preserved.")) return;
    try { await strategyApi.archive(strategy.id); onArchived?.(); }
    catch (reason) { setSaveStatus("error"); setSaveMessage(reason instanceof Error ? reason.message : "We couldn't archive this strategy."); }
  }

  async function validate() {
    dispatch({ type: "validation_started" });
    try { const result = await validateCanonical(state.canonical); dispatch({ type: "validation_finished", ...result }); }
    catch (error) { dispatch({ type: "validation_finished", valid: false, issues: [{ path: "network", message: error instanceof Error ? error.message : String(error) }] }); }
  }

  function tab(view: EditorView, label: string) {
    return <button className={state.editor.activeView === view ? "view-tab active" : "view-tab"} onClick={() => dispatch({ type: "set_active_view", view })} aria-pressed={state.editor.activeView === view}>{label}</button>;
  }

  if (backtest.state.status === "success") {
    return <ResultWorkspace response={backtest.state.result} strategyName={state.canonical.metadata.name} onBack={() => backtest.reset()} />;
  }

  return <section className="strategy-workspace page">
    <header className="workspace-heading"><div><span className="eyebrow">Strategy workspace</span><h1>{strategy?.name ?? state.canonical.metadata.name}</h1><p>{state.canonical.metadata.description}</p>{strategy && <div className="persisted-status"><span className={dirty ? "dirty-dot" : "saved-dot"} />{dirty ? "Unsaved changes" : "Saved"}<button className="text-button" onClick={rename}>Rename</button></div>}</div><div className="workspace-actions">{strategy && <button className="secondary-button" onClick={() => void save()} disabled={!dirty || saveStatus === "saving"}>{saveStatus === "saving" ? "Saving…" : "Save"}</button>}<button className="secondary-button" onClick={validate} disabled={state.validation.status === "checking"}>{state.validation.status === "checking" ? "Checking…" : "Check strategy"}</button><button className="primary-button" onClick={() => setShowSetup(true)}>Set up backtest</button></div></header>
    {saveMessage && <div className={`save-banner ${saveStatus}`} role={saveStatus === "error" || saveStatus === "stale" ? "alert" : "status"}><span>{saveMessage}</span>{saveStatus === "stale" && <button className="secondary-button" onClick={() => void reloadLatest()}>Reload latest</button>}</div>}
    <div className="status-row"><div className="view-tabs">{tab("guided", "Guided")}{tab("flow", "Flow")}</div><span className={`validation-pill ${state.validation.status}`}>{state.validation.status === "valid" ? "Strategy ready" : state.validation.status === "dirty" ? "Edited · check before sharing" : state.validation.status}</span></div>
    {state.validation.issues.length > 0 && <div className="error-panel" role="alert"><strong>Strategy needs attention</strong>{state.validation.issues.map((issue) => <p key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</div>}
    <div className="editing-boundary"><div><span>Strategy</span><b>What the rules do</b></div><p>Run settings such as dates and starting investment are chosen separately.</p></div>
    <section className="editor-area">{state.editor.activeView === "guided" ? <GuidedView /> : <FlowView />}</section>
    {showSetup && <BacktestSetup config={config} onChange={setConfig} onClose={() => setShowSetup(false)} onRun={() => { setShowSetup(false); void backtest.run(state.canonical, config); }} />}
    {backtest.state.status === "running" && <div className="run-overlay" role="status"><span className="loading-spinner" /><h2>Testing your strategy…</h2><p>Following the current rules across the selected period.</p></div>}
    {backtest.state.status === "error" && <BacktestErrorPanel error={backtest.state.error} />}
    {strategy && <div className="workspace-danger"><button className="text-button danger" onClick={() => void archive()}>Archive strategy</button></div>}
  </section>;
}
