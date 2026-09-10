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
import { OverviewView } from "./views/OverviewView";
import { sameCanonicalSnapshot, strategyApi, StrategyApiError, type StrategyDetail } from "./strategyApi";
import { backtestRunApi, BacktestRunApiError, type BacktestRunRecord } from "./backtestRunApi";

export function StrategyEditor({ example, persisted, onDirtyChange, onArchived, onOpenRun, focusComponentId }: { example: StrategyExample; persisted?: StrategyDetail; onDirtyChange?: (dirty: boolean) => void; onArchived?: () => void; onOpenRun?: (runId: string) => void; focusComponentId?: string | null }) {
  const { state, dispatch } = useStrategyEditor();
  const backtest = useBacktestRun();
  const [config, setConfig] = useState<BacktestConfig>(example.backtestDefaults);
  const [showSetup, setShowSetup] = useState(false);
  const [base, setBase] = useState(persisted?.current_revision ?? null);
  const [strategy, setStrategy] = useState(persisted?.strategy ?? null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "stale">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestRunRecord[]>([]);
  const [runsStatus, setRunsStatus] = useState<"loading" | "loaded" | "error">(persisted ? "loading" : "loaded");
  const [persistentRunning, setPersistentRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const dirty = base ? !sameCanonicalSnapshot(state.canonical, base.canonical_strategy) : false;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => { if (focusComponentId) { dispatch({ type: "select_node", componentId: focusComponentId }); dispatch({ type: "set_active_view", view: "guided" }); } }, [focusComponentId, dispatch]);
  useEffect(() => { if (!state.editor.selectedNodeId || state.editor.activeView !== "guided") return; const target = document.querySelector<HTMLElement>(`[data-component-id="${CSS.escape(state.editor.selectedNodeId)}"]`); if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.focus({ preventScroll: true }); } }, [state.editor.selectedNodeId, state.editor.activeView]);
  useEffect(() => {
    if (!strategy || !base) return;
    let cancelled = false; setRunsStatus("loading");
    strategyApi.revisions(strategy.id).then(({ items }) => Promise.all(items.map((revision) => backtestRunApi.list(revision.id)))).then((lists) => {
      if (!cancelled) { setRuns(lists.flatMap((item) => item.items).sort((a, b) => b.created_at.localeCompare(a.created_at))); setRunsStatus("loaded"); }
    }).catch(() => { if (!cancelled) setRunsStatus("error"); });
    return () => { cancelled = true; };
  }, [strategy?.id, base?.id]);

  async function runCurrent() {
    setShowSetup(false); setRunError(null);
    if (!strategy || !base || dirty) { await backtest.run(state.canonical, config); return; }
    setPersistentRunning(true);
    try { const run = await backtestRunApi.create(base.id, config); setRuns((current) => [run, ...current]); onOpenRun?.(run.id); }
    catch (reason) { setRunError(reason instanceof BacktestRunApiError ? reason.detail.message : reason instanceof Error ? reason.message : "We couldn't create this backtest."); }
    finally { setPersistentRunning(false); }
  }

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
    return <ResultWorkspace response={backtest.state.result} strategyName={strategy?.name ?? state.canonical.metadata.name} onBack={() => backtest.reset()} />;
  }

  return <section className="strategy-workspace page">
    <header className="workspace-heading"><div><span className="eyebrow">Investment strategy</span><h1>{strategy?.name ?? state.canonical.metadata.name}</h1><p>{state.canonical.metadata.description}</p>{strategy && <div className="persisted-status"><span className={dirty ? "dirty-dot" : "saved-dot"} />{dirty ? "Unsaved changes" : "Saved"}<button className="text-button" onClick={rename}>Rename</button></div>}</div><div className="workspace-actions">{strategy && <button className="secondary-button" onClick={() => void save()} disabled={!dirty || saveStatus === "saving"}>{saveStatus === "saving" ? "Saving…" : "Save"}</button>}<button className="secondary-button" onClick={validate} disabled={state.validation.status === "checking"}>{state.validation.status === "checking" ? "Checking…" : "Check strategy"}</button><button className="primary-button" onClick={() => setShowSetup(true)}>{dirty ? "Test current changes" : "Test"}</button></div></header>
    {saveMessage && <div className={`save-banner ${saveStatus}`} role={saveStatus === "error" || saveStatus === "stale" ? "alert" : "status"}><span>{saveMessage}</span>{saveStatus === "stale" && <button className="secondary-button" onClick={() => void reloadLatest()}>Reload latest</button>}</div>}
    {state.editor.selectedNodeId && <div className="source-focus-banner" role="status"><span><strong>Rule from the result</strong> The related strategy setting is highlighted below.</span><button className="text-button" onClick={() => dispatch({ type: "select_node", componentId: null })}>Dismiss</button></div>}
    <div className="status-row"><div className="view-tabs">{tab("overview", "Overview")}{tab("guided", "Guided")}{tab("flow", "Flow")}</div><span className={`validation-pill ${state.validation.status}`}>{state.validation.status === "valid" ? "Strategy ready" : state.validation.status === "dirty" ? "Edited · check before sharing" : state.validation.status}</span></div>
    {state.validation.issues.length > 0 && <div className="error-panel" role="alert"><strong>Strategy needs attention</strong>{state.validation.issues.map((issue) => <p key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</div>}
    <div className="editing-boundary"><div><span>Strategy</span><b>What the rules do</b></div><p>Run settings such as dates and starting investment are chosen separately.</p></div>
    <section className="editor-area">{state.editor.activeView === "overview" ? <OverviewView onTest={() => setShowSetup(true)} /> : state.editor.activeView === "guided" ? <GuidedView /> : <FlowView />}</section>
    {strategy && <section className="run-history"><header><div><span className="eyebrow">Backtests</span><h2>Saved results</h2></div><span>Each run stays with the revision it tested.</span></header>{runsStatus === "loading" && <p role="status">Loading backtests…</p>}{runsStatus === "error" && <p>Backtest history is temporarily unavailable.</p>}{runsStatus === "loaded" && runs.length === 0 && <p>No saved backtests yet.</p>}{runs.map((run) => <button key={run.id} className="run-history-item" onClick={() => onOpenRun?.(run.id)}><span><strong>{new Date(run.created_at).toLocaleDateString()}</strong><small>{run.run_config.start_date} – {run.run_config.end_date}{run.revision_id !== base?.id ? " · Earlier revision" : ""}</small></span><span className={`run-status ${run.status}`}>{run.status === "succeeded" && run.result ? new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1 }).format(Number(run.result.total_return)) : run.status}</span></button>)}</section>}
    {showSetup && <BacktestSetup config={config} onChange={setConfig} onClose={() => setShowSetup(false)} onRun={() => void runCurrent()} persistence={strategy && base && !dirty ? "historical" : "temporary"} />}
    {(backtest.state.status === "running" || persistentRunning) && <div className="run-overlay" role="status"><span className="loading-spinner" /><h2>Testing your strategy…</h2><p>{persistentRunning ? "Creating a saved backtest result." : "Testing unsaved changes temporarily."}</p></div>}
    {backtest.state.status === "error" && <BacktestErrorPanel error={backtest.state.error} />}
    {runError && <div className="backtest-error" role="alert"><strong>We couldn't run this backtest</strong><p>{runError}</p></div>}
    {strategy && <div className="workspace-danger"><button className="text-button danger" onClick={() => void archive()}>Archive strategy</button></div>}
  </section>;
}
