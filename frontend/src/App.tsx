import { useCallback, useEffect, useState } from "react";
import { loadEditorBootstrap } from "./api";
import { AppShell } from "./components/AppShell";
import type { EditorBootstrap } from "./domain/canonical";
import { findExample, type ExampleId, type StrategyExample } from "./domain/examples";
import { pathForRoute, routeFromPath, type AppRoute } from "./domain/navigation";
import { StrategyEditor } from "./StrategyEditor";
import { StrategyEditorProvider } from "./store/editorStore";
import { strategyApi, type StrategyDetail, type StrategyRecord } from "./strategyApi";
import { ExploreView } from "./views/ExploreView";
import { StrategiesView } from "./views/StrategiesView";
import { backtestRunApi, type BacktestRunRecord } from "./backtestRunApi";
import { ResultWorkspace } from "./components/ResultWorkspace";

type LoadState = "idle" | "loading" | "loaded" | "error";

function defaultsFor(bootstrap: EditorBootstrap): StrategyExample {
  const cooldown = bootstrap.strategy.graph.components.some((item) => item.primitive.toLowerCase().includes("cooldown"));
  return findExample(cooldown ? "cooldown" : "sleeves")!;
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));
  const [workspace, setWorkspace] = useState<{ bootstrap: EditorBootstrap; example: StrategyExample; detail?: StrategyDetail } | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<LoadState>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [listStatus, setListStatus] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [createDraft, setCreateDraft] = useState<{ id: ExampleId; bootstrap: EditorBootstrap; name: string } | null>(null);
  const [creating, setCreating] = useState<ExampleId | null>(null);
  const [historicalRun, setHistoricalRun] = useState<BacktestRunRecord | null>(null);
  const [runStatus, setRunStatus] = useState<LoadState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [focusComponentId, setFocusComponentId] = useState<string | null>(null);

  const navigate = useCallback((next: AppRoute, preserveFocus = false) => {
    if (dirty && route.page === "strategy" && next.page !== "strategy" && !window.confirm("Leave with unsaved strategy changes? They will be lost.")) return;
    if (!preserveFocus) setFocusComponentId(null);
    window.history.pushState(null, "", pathForRoute(next)); setRoute(next); if (next.page !== "strategy") setDirty(false);
  }, [dirty, route.page]);

  useEffect(() => { const onPopState = () => setRoute(routeFromPath(window.location.pathname)); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => { const onBeforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", onBeforeUnload); return () => window.removeEventListener("beforeunload", onBeforeUnload); }, [dirty]);

  const loadList = useCallback(async () => {
    setListStatus("loading"); setListError(null);
    try { const result = await strategyApi.list(); setStrategies(result.items); setListStatus("loaded"); }
    catch (reason) { setListError(reason instanceof Error ? reason.message : "The backend is unavailable."); setListStatus("error"); }
  }, []);
  useEffect(() => { if (route.page === "strategies") void loadList(); }, [route.page, loadList]);

  useEffect(() => {
    if (route.page !== "run") return;
    let cancelled = false; const runId = route.runId; setRunStatus("loading"); setRunError(null); setHistoricalRun(null);
    backtestRunApi.get(runId).then((run) => { if (!cancelled) { setHistoricalRun(run); setRunStatus("loaded"); } }).catch((reason: unknown) => { if (!cancelled) { setRunError(reason instanceof Error ? reason.message : "We couldn't load this backtest."); setRunStatus("error"); } });
    return () => { cancelled = true; };
  }, [route]);

  useEffect(() => {
    if (route.page !== "example" && route.page !== "strategy") return;
    let cancelled = false; setWorkspaceStatus("loading"); setWorkspaceError(null); setWorkspace(null); setDirty(false);
    const task = route.page === "example"
      ? (() => { const exampleId = route.exampleId; return loadEditorBootstrap(exampleId).then((bootstrap) => ({ bootstrap, example: findExample(exampleId)! })); })()
      : (() => { const strategyId = route.strategyId; return Promise.all([strategyApi.get(strategyId), loadEditorBootstrap("sleeves")]).then(([detail, registryBootstrap]) => {
          const bootstrap = { ...registryBootstrap, strategy: detail.current_revision.canonical_strategy, validation: { valid: true, issues: [] } };
          return { bootstrap, example: defaultsFor(bootstrap), detail };
        }); })();
    task.then((value) => { if (!cancelled) { setWorkspace(value); setWorkspaceStatus("loaded"); } }).catch((reason: unknown) => { if (!cancelled) { setWorkspaceError(reason instanceof Error ? reason.message : String(reason)); setWorkspaceStatus("error"); } });
    return () => { cancelled = true; };
  }, [route]);

  async function beginCreate(id: ExampleId) {
    setCreating(id);
    try { const bootstrap = await loadEditorBootstrap(id); setCreateDraft({ id, bootstrap, name: findExample(id)!.title }); }
    catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : "We couldn't load this example."); }
    finally { setCreating(null); }
  }

  async function confirmCreate() {
    if (!createDraft?.name.trim()) return;
    setCreating(createDraft.id);
    try { const detail = await strategyApi.create(createDraft.name.trim(), createDraft.bootstrap.strategy); setCreateDraft(null); navigate({ page: "strategy", strategyId: detail.strategy.id }); }
    catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : "We couldn't create this strategy."); }
    finally { setCreating(null); }
  }

  async function showInStrategy(revisionId: string, componentId: string) {
    try {
      const active = await strategyApi.list();
      const matches = await Promise.all(active.items.map(async (item) => ({ item, revisions: (await strategyApi.revisions(item.id)).items })));
      const owner = matches.find(({ revisions }) => revisions.some((revision) => revision.id === revisionId))?.item;
      if (!owner) { setRunError("The active strategy for this historical version could not be found."); return; }
      setFocusComponentId(componentId); navigate({ page: "strategy", strategyId: owner.id }, true);
    } catch (reason) { setRunError(reason instanceof Error ? reason.message : "We couldn't open the strategy rule."); }
  }

  const strategyName = workspace?.detail?.strategy.name ?? (route.page === "example" ? findExample(route.exampleId)?.title : undefined);
  return <AppShell route={route} strategyName={strategyName} navigate={navigate}>
    {route.page === "explore" && <ExploreView onOpen={(exampleId) => navigate({ page: "example", exampleId })} onUse={(id) => void beginCreate(id)} creating={creating} />}
    {route.page === "strategies" && <StrategiesView status={listStatus === "idle" ? "loading" : listStatus} strategies={strategies} error={listError} onExplore={() => navigate({ page: "explore" })} onOpen={(strategyId) => navigate({ page: "strategy", strategyId })} onRetry={() => void loadList()} />}
    {(route.page === "example" || route.page === "strategy") && workspaceStatus === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening strategy…</h1><p>Loading its saved Canonical source.</p></div>}
    {(route.page === "example" || route.page === "strategy") && workspaceStatus === "error" && <div className="page-state error-state" role="alert"><h1>We couldn't open this strategy</h1><p>{workspaceError}</p><button className="primary-button" onClick={() => navigate({ page: "strategies" })}>Back to My Strategies</button></div>}
    {(route.page === "example" || route.page === "strategy") && workspace && workspaceStatus === "loaded" && <StrategyEditorProvider key={workspace.detail?.current_revision.id ?? workspace.example.id} bootstrap={workspace.bootstrap}><StrategyEditor example={workspace.example} persisted={workspace.detail} onDirtyChange={setDirty} onArchived={() => navigate({ page: "strategies" })} onOpenRun={(runId) => navigate({ page: "run", runId })} focusComponentId={focusComponentId} /></StrategyEditorProvider>}
    {route.page === "run" && runStatus === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening saved backtest…</h1><p>Loading the historical result without running it again.</p></div>}
    {route.page === "run" && runStatus === "error" && <div className="page-state error-state" role="alert"><h1>We couldn't open this backtest</h1><p>{runError}</p><button className="primary-button" onClick={() => navigate({ page: "strategies" })}>Back to My Strategies</button></div>}
    {route.page === "run" && runStatus === "loaded" && historicalRun && <ResultWorkspace run={historicalRun} strategyName="Historical backtest" onBack={() => window.history.back()} onShowInStrategy={(revisionId, componentId) => void showInStrategy(revisionId, componentId)} />}
    {createDraft && <div className="modal-backdrop" role="presentation"><form className="create-dialog" aria-labelledby="create-title" onSubmit={(event) => { event.preventDefault(); void confirmCreate(); }}><span className="eyebrow">New strategy</span><h2 id="create-title">Make this example yours</h2><p>The template stays unchanged. This creates your own saved strategy and first revision.</p><label>Strategy name<input autoFocus value={createDraft.name} maxLength={100} onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })} /></label><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreateDraft(null)}>Cancel</button><button className="primary-button" disabled={!createDraft.name.trim() || creating !== null}>{creating ? "Creating…" : "Create strategy"}</button></div></form></div>}
  </AppShell>;
}
