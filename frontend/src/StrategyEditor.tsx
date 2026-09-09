import { useState } from "react";
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

export function StrategyEditor({ example }: { example: StrategyExample }) {
  const { state, dispatch } = useStrategyEditor();
  const backtest = useBacktestRun();
  const [config, setConfig] = useState<BacktestConfig>(example.backtestDefaults);
  const [showSetup, setShowSetup] = useState(false);

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
    <header className="workspace-heading"><div><span className="eyebrow">Strategy workspace</span><h1>{state.canonical.metadata.name}</h1><p>{state.canonical.metadata.description}</p></div><div className="workspace-actions"><button className="secondary-button" onClick={validate} disabled={state.validation.status === "checking"}>{state.validation.status === "checking" ? "Checking…" : "Check strategy"}</button><button className="primary-button" onClick={() => setShowSetup(true)}>Set up backtest</button></div></header>
    <div className="status-row"><div className="view-tabs">{tab("guided", "Guided")}{tab("flow", "Flow")}</div><span className={`validation-pill ${state.validation.status}`}>{state.validation.status === "valid" ? "Strategy ready" : state.validation.status === "dirty" ? "Edited · check before sharing" : state.validation.status}</span></div>
    {state.validation.issues.length > 0 && <div className="error-panel" role="alert"><strong>Strategy needs attention</strong>{state.validation.issues.map((issue) => <p key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</div>}
    <div className="editing-boundary"><div><span>Strategy</span><b>What the rules do</b></div><p>Run settings such as dates and starting investment are chosen separately.</p></div>
    <section className="editor-area">{state.editor.activeView === "guided" ? <GuidedView /> : <FlowView />}</section>
    {showSetup && <BacktestSetup config={config} onChange={setConfig} onClose={() => setShowSetup(false)} onRun={() => { setShowSetup(false); void backtest.run(state.canonical, config); }} />}
    {backtest.state.status === "running" && <div className="run-overlay" role="status"><span className="loading-spinner" /><h2>Testing your strategy…</h2><p>Following the current rules across the selected period.</p></div>}
    {backtest.state.status === "error" && <BacktestErrorPanel error={backtest.state.error} />}
  </section>;
}
