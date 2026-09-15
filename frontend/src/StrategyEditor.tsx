import { useEffect, useReducer, useState } from "react";
import { BacktestErrorPanel } from "./components/BacktestErrorPanel";
import { BacktestSetup } from "./components/BacktestSetup";
import { ResultWorkspace } from "./components/ResultWorkspace";
import { ComparisonWorkspace } from "./components/ComparisonWorkspace";
import { RuleEvidenceHistory } from "./components/RuleEvidenceHistory";
import { WorkspaceActivity } from "./components/WorkspaceDashboard";
import type { BacktestConfig } from "./domain/backtest";
import {
  canLaunchPersistedRealDataRun,
  dataReadinessKey,
  freshDataReadiness,
  readinessFromResult,
  type DataReadiness,
} from "./domain/marketDataReadiness";
import type { StrategyExample } from "./domain/examples";
import type { ResearchContext } from "./domain/researchContext";
import { projectConceptualFlow } from "./domain/conceptualFlow";
import { semanticSelection } from "./domain/semanticSelection";
import {
  INITIAL_WORKBENCH_RESEARCH,
  researchTitle,
  workbenchResearchReducer,
} from "./domain/workbenchResearch";
import { useBacktestRun } from "./hooks/useBacktestRun";
import { useStructuralAuthoring } from "./hooks/useStructuralAuthoring";
import { useStrategyEditor } from "./store/editorStore";
import { StrategyBuilderWorkspace } from "./components/StrategyBuilderWorkspace";
import { sameCanonicalSnapshot, strategyApi, StrategyApiError, type RevisionSummary, type StrategyDetail } from "./strategyApi";
import { backtestRunApi, BacktestRunApiError, type BacktestRunRecord } from "./backtestRunApi";
import {
  marketDataApi,
  MarketDataApiError,
  type MarketDataPreflight,
} from "./marketDataApi";

export function StrategyEditor({ example, persisted, confirmation, initialTestOpen = false, onDirtyChange, sourceFocus, onHome = () => undefined }: { example: StrategyExample; persisted?: StrategyDetail; confirmation?: string | null; initialTestOpen?: boolean; onDirtyChange?: (dirty: boolean) => void; onArchived?: () => void; sourceFocus?: { revisionId: string; componentId: string; fieldPath?: string | null; researchContext?: ResearchContext } | null; onHome?: () => void }) {
  const { state, dispatch } = useStrategyEditor();
  const backtest = useBacktestRun();
  const structural = useStructuralAuthoring();
  const [config, setConfig] = useState<BacktestConfig>(example.backtestDefaults);
  const [showSetup, setShowSetup] = useState(initialTestOpen);
  const [base, setBase] = useState(persisted?.current_revision ?? null);
  const [strategy, setStrategy] = useState(persisted?.strategy ?? null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "stale">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestRunRecord[]>([]);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [runsStatus, setRunsStatus] = useState<"loading" | "loaded" | "error">(persisted ? "loading" : "loaded");
  const [research, researchDispatch] = useReducer(workbenchResearchReducer, INITIAL_WORKBENCH_RESEARCH);
  const [activeRun, setActiveRun] = useState<BacktestRunRecord | null>(null);
  const [researchLoad, setResearchLoad] = useState<"idle" | "loading" | "error">("idle");
  const [localSourceFocus, setLocalSourceFocus] = useState<typeof sourceFocus>(null);
  const [persistentRunning, setPersistentRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [dataReadiness, setDataReadiness] = useState<DataReadiness>({ status: "not_checked" });
  const dirty = base ? !sameCanonicalSnapshot(state.canonical, base.canonical_strategy) : false;
  const readinessKey = base && !dirty && config.dataset_id === "us-equity-daily-local"
    ? dataReadinessKey(base.id, config)
    : null;
  const readiness = freshDataReadiness(dataReadiness, readinessKey);
  const currentSourceFocus = localSourceFocus ?? sourceFocus;
  const activeSourceFocus = currentSourceFocus
    && state.editor.selection?.componentId === currentSourceFocus.componentId
    && state.editor.selection?.fieldPath === (currentSourceFocus.fieldPath ?? null)
    ? currentSourceFocus
    : null;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => { if (sourceFocus) { focusRule(sourceFocus.revisionId, sourceFocus.componentId, sourceFocus.fieldPath, sourceFocus.researchContext ?? null, false); if (sourceFocus.researchContext) void openRun(sourceFocus.researchContext.runId, sourceFocus.researchContext); } }, [sourceFocus]);
  useEffect(() => {
    if (!state.editor.selection?.componentId || state.editor.activeView !== "guided") return;
    const component = CSS.escape(state.editor.selection.componentId);
    const exact = state.editor.selection.fieldPath
      ? document.querySelector<HTMLElement>(`[data-component-id="${component}"][data-field-path="${CSS.escape(state.editor.selection.fieldPath)}"]`)
      : null;
    const target = exact ?? document.querySelector<HTMLElement>(`[data-component-id="${component}"]`);
    if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.focus({ preventScroll: true }); }
  }, [state.editor.selection, state.editor.activeView]);
  useEffect(() => {
    if (!strategy || !base) return;
    let cancelled = false; setRunsStatus("loading");
    strategyApi.revisions(strategy.id).then(async ({ items }) => ({ items, lists: await Promise.all(items.map((revision) => backtestRunApi.list(revision.id))) })).then(({ items, lists }) => {
      if (!cancelled) { setRevisions(items); setRuns(lists.flatMap((item) => item.items).sort((a, b) => b.created_at.localeCompare(a.created_at))); setRunsStatus("loaded"); }
    }).catch(() => { if (!cancelled) setRunsStatus("error"); });
    return () => { cancelled = true; };
  }, [strategy?.id, base?.id]);

  async function openRun(runId: string, context: ResearchContext | null = null) {
    researchDispatch({ type: "open_run", runId, context });
    setResearchLoad("loading");
    const existing = runs.find((item) => item.id === runId);
    if (existing) {
      setActiveRun(existing);
      setResearchLoad("idle");
      return;
    }
    try {
      setActiveRun(await backtestRunApi.get(runId));
      setResearchLoad("idle");
    } catch {
      setActiveRun(null);
      setResearchLoad("error");
    }
  }

  function focusRule(
    revisionId: string,
    componentId: string,
    fieldPath: string | null | undefined,
    context: ResearchContext | null,
    viewInFlow: boolean,
  ) {
    setLocalSourceFocus({ revisionId, componentId, fieldPath, researchContext: context ?? undefined });
    dispatch({ type: "select_semantic", selection: semanticSelection("rule", componentId, { fieldPath }) });
    if (viewInFlow) dispatch({ type: "set_active_view", view: "flow" });
  }

  async function acceptAdoption(response: Awaited<ReturnType<typeof strategyApi.save>>) {
    setStrategy(response.strategy);
    setBase(response.revision);
    dispatch({ type: "replace_canonical", canonical: response.revision.canonical_strategy });
    setSaveStatus("saved");
    setSaveMessage("This change is now part of your strategy. You can test it again now.");
  }

  async function openLatest() {
    if (!strategy) return;
    try {
      const latest = await strategyApi.get(strategy.id);
      setStrategy(latest.strategy);
      setBase(latest.current_revision);
      dispatch({ type: "replace_canonical", canonical: latest.current_revision.canonical_strategy });
      setSaveStatus("idle");
      setSaveMessage(null);
    } catch (reason) {
      setSaveStatus("error");
      setSaveMessage(reason instanceof Error ? reason.message : "We couldn't open the latest strategy.");
    }
  }

  async function checkDataReadiness(targetConfig = config): Promise<MarketDataPreflight | null> {
    if (!base || dirty || targetConfig.dataset_id !== "us-equity-daily-local") return null;
    const key = dataReadinessKey(base.id, targetConfig);
    setDataReadiness({ status: "checking", key });
    try {
      const result = await marketDataApi.preflight(base.id, targetConfig);
      setDataReadiness(readinessFromResult(key, result));
      return result;
    } catch (reason) {
      const message = reason instanceof MarketDataApiError
        ? reason.detail.message
        : reason instanceof Error ? reason.message : "Preflight request failed.";
      setDataReadiness({ status: "error", key, message });
      return null;
    }
  }

  function openTestSetup() {
    setShowSetup(true);
    if (base && !dirty && config.dataset_id === "us-equity-daily-local") {
      void checkDataReadiness();
    }
  }

  useEffect(() => {
    if (backtest.state.status === "success") researchDispatch({ type: "open_temporary_result" });
  }, [backtest.state.status]);

  async function runCurrent() {
    setRunError(null);
    if (!strategy || !base || dirty) {
      setShowSetup(false);
      await backtest.run(state.canonical, config);
      return;
    }
    if (config.dataset_id === "us-equity-daily-local") {
      const checked = readinessKey && canLaunchPersistedRealDataRun(readiness, readinessKey)
        && readiness.status === "available"
        ? readiness.result
        : await checkDataReadiness();
      if (!checked || checked.overall !== "available") return;
    }
    setShowSetup(false);
    setPersistentRunning(true);
    try {
      const run = await backtestRunApi.create(base.id, config);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRun(run);
      setResearchLoad("idle");
      researchDispatch({ type: "open_run", runId: run.id });
    }
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

  const evidence = strategy && base && state.editor.selection?.componentId && runsStatus === "loaded"
    ? <RuleEvidenceHistory revisionId={activeSourceFocus?.revisionId ?? base.id} target={{ componentId: state.editor.selection.componentId, fieldPath: state.editor.selection.fieldPath }} runs={runs} preferredAsset={activeSourceFocus?.researchContext?.asset} onOpen={(context) => void openRun(context.runId, context)} /> : undefined;
  const notices = <>{confirmation && <div className="save-banner saved" role="status"><span>✓ {confirmation}</span></div>}{saveMessage && <div className={`save-banner ${saveStatus}`} role={saveStatus === "error" || saveStatus === "stale" ? "alert" : "status"}><span>{saveMessage}</span>{saveStatus === "stale" && <button className="secondary-button" onClick={() => void reloadLatest()}>Reload latest</button>}</div>}</>;
  const validationPanel = state.validation.issues.length > 0 ? <div className="error-panel" role="alert"><strong>Strategy needs attention</strong>{state.validation.issues.map(issue=><p key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</div> : null;
  const activityContent = <WorkspaceActivity revisionId={base?.id ?? null} revisionCount={revisions.length} runs={runs} status={runsStatus} onOpenRun={(runId) => void openRun(runId)} />;
  let researchContent = <div className="research-state"><h2>Select saved research</h2><p>Open Activity to choose a saved result.</p></div>;
  if (research.destination?.kind === "temporary_result" && backtest.state.status === "success") {
    researchContent = <ResultWorkspace response={backtest.state.result} strategyName={strategy?.name ?? state.canonical.metadata.name} onBack={() => researchDispatch({ type: "close_research" })} />;
  } else if (research.destination?.kind === "run") {
    researchContent = researchLoad === "loading"
      ? <div className="research-state" role="status"><span className="loading-spinner" /><h2>Opening saved result…</h2><p>No backtest is being rerun.</p></div>
      : researchLoad === "error" || !activeRun
        ? <div className="research-state error-state" role="alert"><h2>We couldn't open this saved result</h2><p>Your Strategy is unchanged.</p></div>
        : <ResultWorkspace key={activeRun.id} run={activeRun} strategyName={strategy?.name ?? "Historical backtest"} onBack={() => researchDispatch({ type: "close_research" })} researchContext={research.context?.runId === activeRun.id ? research.context : null} onResearchContextChange={(context) => researchDispatch({ type: "set_context", context })} onShowInStrategy={(revisionId, componentId, fieldPath, context) => focusRule(revisionId, componentId, fieldPath, context, false)} onViewInFlow={(revisionId, componentId, fieldPath, context) => focusRule(revisionId, componentId, fieldPath, context, true)} onComparisonReady={(comparison, context) => researchDispatch({ type: "open_comparison", comparisonId: comparison.id, context })} />;
  } else if (research.destination?.kind === "comparison") {
    researchContent = <ComparisonWorkspace comparisonId={research.destination.comparisonId} initialContext={research.context} onContextChange={(context) => researchDispatch({ type: "set_context", context })} onOpenRun={(runId, context) => void openRun(runId, context ?? null)} onViewRule={(revisionId, componentId, fieldPath, context) => focusRule(revisionId, componentId, fieldPath, context, false)} onAdopted={(response) => void acceptAdoption(response)} onOpenLatest={() => void openLatest()} />;
  }
  return <><StrategyBuilderWorkspace name={strategy?.name ?? state.canonical.metadata.name} dirty={dirty} saving={saveStatus === "saving"} persisted={Boolean(strategy)} projection={projectConceptualFlow(state.canonical,state.registry)} structural={structural} inspectorEvidence={evidence} notices={notices} validation={validationPanel} research={strategy ? { activityOpen: research.activityOpen, researchOpen: research.researchOpen, canOpenResearch: Boolean(research.destination), size: research.size, title: researchTitle(research.destination), hasActivity: runs.length > 0, content: researchContent, activity: activityContent, onToggleActivity: () => researchDispatch({ type: "toggle_activity" }), onToggleResearch: () => researchDispatch(research.researchOpen ? { type: "close_research" } : { type: "reopen_research" }), onResize: (size) => researchDispatch({ type: "set_size", size }) } : undefined} onHome={onHome} onRename={()=>void rename()} onSave={()=>void save()} onTest={openTestSetup}/>
    {showSetup && <BacktestSetup config={config} onChange={setConfig} onClose={() => setShowSetup(false)} onRun={() => void runCurrent()} onCheckData={() => void checkDataReadiness()} readiness={readiness} exampleDatasetId={example.backtestDefaults.dataset_id} persistence={strategy && base && !dirty ? "historical" : "temporary"} />}
    {(backtest.state.status === "running" || persistentRunning) && <div className="run-overlay" role="status"><span className="loading-spinner" /><h2>Testing your strategy…</h2><p>{persistentRunning ? "Creating a saved backtest result." : "Testing unsaved changes temporarily."}</p></div>}
    {backtest.state.status === "error" && <BacktestErrorPanel error={backtest.state.error} />}
    {runError && <div className="backtest-error" role="alert"><strong>We couldn't run this backtest</strong><p>{runError}</p></div>}
  </>;
}
