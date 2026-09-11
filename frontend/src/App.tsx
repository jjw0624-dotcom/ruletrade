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
import { HomeView } from "./views/HomeView";
import { PublicView } from "./views/PublicView";
import { ExamplePreview } from "./views/ExamplePreview";
import { CreationPicker } from "./components/CreationPicker";
import { backtestRunApi, type BacktestRunRecord } from "./backtestRunApi";
import { ResultWorkspace } from "./components/ResultWorkspace";
import type { ResearchContext } from "./domain/researchContext";
import { ComparisonWorkspace } from "./components/ComparisonWorkspace";

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
  const [createDraft, setCreateDraft] = useState<{ id: ExampleId; bootstrap: EditorBootstrap; name: string; initialView: "overview" | "guided" } | null>(null);
  const [creating, setCreating] = useState<ExampleId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [previewTesting, setPreviewTesting] = useState(false);
  const [createdDestination, setCreatedDestination] = useState<{ strategyId: string; view: "overview" | "guided" } | null>(null);
  const [historicalRun, setHistoricalRun] = useState<BacktestRunRecord | null>(null);
  const [runStatus, setRunStatus] = useState<LoadState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [sourceFocus, setSourceFocus] = useState<{ componentId: string; fieldPath?: string | null; researchContext?: ResearchContext; returnRoute?: AppRoute } | null>(null);
  const [researchContext, setResearchContext] = useState<ResearchContext | null>(null);
  const [comparisonContext, setComparisonContext] = useState<{ comparisonId: string; context: ResearchContext } | null>(null);
  const [adoptionNotice, setAdoptionNotice] = useState<string | null>(null);

  const navigate = useCallback((next: AppRoute, preserveFocus = false) => {
    if (dirty && route.page === "strategy" && next.page !== "strategy" && !window.confirm("Leave with unsaved strategy changes? They will be lost.")) return;
    if (!preserveFocus) setSourceFocus(null);
    setPreviewTesting(false);
    if (next.page !== "strategy") setAdoptionNotice(null);
    window.history.pushState(null, "", pathForRoute(next)); setRoute(next); if (next.page !== "strategy") setDirty(false);
  }, [dirty, route.page]);

  useEffect(() => { const onPopState = () => setRoute(routeFromPath(window.location.pathname)); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => { const onBeforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", onBeforeUnload); return () => window.removeEventListener("beforeunload", onBeforeUnload); }, [dirty]);

  const loadList = useCallback(async () => {
    setListStatus("loading"); setListError(null);
    try { const result = await strategyApi.list(); setStrategies(result.items); setListStatus("loaded"); }
    catch (reason) { setListError(reason instanceof Error ? reason.message : "The backend is unavailable."); setListStatus("error"); }
  }, []);
  useEffect(() => { if (["home", "explore", "example"].includes(route.page)) void loadList(); }, [route.page, loadList]);

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
    setCreating(id); setCreateError(null);
    try { const point = findExample(id)!; const bootstrap = await loadEditorBootstrap(id); setCreateDraft({ id, bootstrap, name: point.title, initialView: point.initialView }); setPickerOpen(false); }
    catch (reason) { setCreateError(reason instanceof Error ? reason.message : "We couldn't load this starting point."); setPickerOpen(true); }
    finally { setCreating(null); }
  }

  async function confirmCreate() {
    if (!createDraft?.name.trim()) return;
    setCreating(createDraft.id);
    try { const detail = await strategyApi.create(createDraft.name.trim(), createDraft.bootstrap.strategy); setCreatedDestination({ strategyId: detail.strategy.id, view: createDraft.initialView }); setCreateDraft(null); setPreviewTesting(false); navigate({ page: "strategy", strategyId: detail.strategy.id }); }
    catch (reason) { setCreateError(reason instanceof Error ? reason.message : "We couldn't create this strategy."); }
    finally { setCreating(null); }
  }

  async function openStrategyOwningRevision(revisionId: string) {
    const active = await strategyApi.list();
    const matches = await Promise.all(active.items.map(async (item) => ({ item, revisions: (await strategyApi.revisions(item.id)).items })));
    const owner = matches.find(({ revisions }) => revisions.some((revision) => revision.id === revisionId))?.item;
    if (!owner) throw new Error("The active strategy for this version could not be found.");
    navigate({ page: "strategy", strategyId: owner.id });
  }

  async function showInStrategy(revisionId: string, componentId: string, fieldPath: string | null | undefined, context: ResearchContext, returnRoute: AppRoute = { page: "run", runId: context.runId }) {
    try {
      const active = await strategyApi.list();
      const matches = await Promise.all(active.items.map(async (item) => ({ item, revisions: (await strategyApi.revisions(item.id)).items })));
      const owner = matches.find(({ revisions }) => revisions.some((revision) => revision.id === revisionId))?.item;
      if (!owner) { setRunError("The active strategy for this historical version could not be found."); return; }
      setResearchContext(context); setSourceFocus({ componentId, fieldPath, researchContext: context, returnRoute }); navigate({ page: "strategy", strategyId: owner.id }, true);
    } catch (reason) { setRunError(reason instanceof Error ? reason.message : "We couldn't open the strategy rule."); }
  }

  const strategyName = workspace?.detail?.strategy.name ?? (route.page === "example" ? findExample(route.exampleId)?.title : undefined);
  const recent = [...strategies].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const openPicker = () => { setCreateError(null); setPickerOpen(true); };
  const chooseStartingPoint = (id: ExampleId) => { const point = findExample(id)!; if (point.kind === "example") { setPickerOpen(false); navigate({ page: "example", exampleId: id }); } else void beginCreate(id); };
  return <AppShell route={route} strategyName={strategyName} recent={recent} navigate={navigate} onCreate={openPicker}>
    {route.page === "public" && <PublicView onExample={(exampleId) => navigate({ page: "example", exampleId })} onHome={() => navigate({ page: "home" })} onCreate={openPicker} />}
    {route.page === "home" && <HomeView status={listStatus === "idle" ? "loading" : listStatus} strategies={strategies} error={listError} onOpen={(strategyId) => navigate({ page: "strategy", strategyId })} onRetry={() => void loadList()} onCreate={openPicker} onExample={(exampleId) => navigate({ page: "example", exampleId })} />}
    {route.page === "explore" && <ExploreView onOpen={(exampleId) => navigate({ page: "example", exampleId })} onCreate={openPicker} />}
    {(route.page === "example" || route.page === "strategy") && workspaceStatus === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening strategy…</h1><p>Loading its saved rules.</p></div>}
    {(route.page === "example" || route.page === "strategy") && workspaceStatus === "error" && <div className="page-state error-state" role="alert"><h1>We couldn't open this strategy</h1><p>{workspaceError}</p><button className="primary-button" onClick={() => navigate({ page: "home" })}>Back to My Strategies</button></div>}
    {route.page === "example" && workspace && workspaceStatus === "loaded" && !previewTesting && <ExamplePreview point={workspace.example} bootstrap={workspace.bootstrap} onBack={() => navigate({ page: "explore" })} onTest={() => setPreviewTesting(true)} onStart={() => void beginCreate(workspace.example.id)} creating={creating === workspace.example.id} />}
    {(route.page === "strategy" || (route.page === "example" && previewTesting)) && workspace && workspaceStatus === "loaded" && <StrategyEditorProvider key={workspace.detail?.current_revision.id ?? `${workspace.example.id}-test`} bootstrap={workspace.bootstrap} initialView={workspace.detail && createdDestination?.strategyId === workspace.detail.strategy.id ? createdDestination.view : "overview"}><StrategyEditor example={workspace.example} persisted={workspace.detail} confirmation={adoptionNotice} initialTestOpen={route.page === "example" && previewTesting} onDirtyChange={setDirty} onArchived={() => navigate({ page: "home" })} onOpenRun={(runId) => navigate({ page: "run", runId })} sourceFocus={sourceFocus} onBackToResearch={sourceFocus?.returnRoute ? () => navigate(sourceFocus.returnRoute!) : undefined} backToResearchLabel={sourceFocus?.researchContext ? `Back to ${new Date(`${sourceFocus.researchContext.sessionId}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${sourceFocus.researchContext.asset ? ` · ${sourceFocus.researchContext.asset}` : ""}` : undefined} /></StrategyEditorProvider>}
    {route.page === "run" && runStatus === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening saved backtest…</h1><p>Loading the historical result without running it again.</p></div>}
    {route.page === "run" && runStatus === "error" && <div className="page-state error-state" role="alert"><h1>We couldn't open this backtest</h1><p>{runError}</p><button className="primary-button" onClick={() => navigate({ page: "home" })}>Back to My Strategies</button></div>}
    {route.page === "run" && runStatus === "loaded" && historicalRun && <ResultWorkspace key={historicalRun.id} run={historicalRun} strategyName={historicalRun.candidate_id ? "Candidate result" : "Historical backtest"} onBack={() => window.history.back()} researchContext={researchContext?.runId === historicalRun.id ? researchContext : null} onResearchContextChange={setResearchContext} onShowInStrategy={(revisionId, componentId, fieldPath, context) => void showInStrategy(revisionId, componentId, fieldPath, context)} onComparisonReady={(comparison, context) => { setResearchContext(context); setComparisonContext({ comparisonId: comparison.id, context }); navigate({ page: "comparison", comparisonId: comparison.id }); }} />}
    {route.page === "comparison" && <ComparisonWorkspace comparisonId={route.comparisonId} initialContext={comparisonContext?.comparisonId === route.comparisonId ? comparisonContext.context : null} onContextChange={(context) => setComparisonContext({ comparisonId: route.comparisonId, context })} onOpenRun={(runId, context) => { if (context) { setResearchContext(context); setComparisonContext({ comparisonId: route.comparisonId, context }); } navigate({ page: "run", runId }); }} onViewRule={(revisionId, componentId, fieldPath, context) => void showInStrategy(revisionId, componentId, fieldPath, context, { page: "comparison", comparisonId: route.comparisonId })} onAdopted={(response) => { setAdoptionNotice("This change is now part of your strategy."); setSourceFocus(null); navigate({ page: "strategy", strategyId: response.strategy.id }); }} onOpenLatest={(revisionId) => { setAdoptionNotice(null); void openStrategyOwningRevision(revisionId).catch((reason: unknown) => setRunError(reason instanceof Error ? reason.message : "We couldn't open the latest strategy.")); }} />}
    {pickerOpen && <CreationPicker onChoose={chooseStartingPoint} onClose={() => setPickerOpen(false)} loading={creating} error={createError} />}
    {createDraft && <div className="modal-backdrop" role="presentation"><form className="create-dialog" aria-labelledby="create-title" onSubmit={(event) => { event.preventDefault(); void confirmCreate(); }}><span className="eyebrow">New strategy</span><h2 id="create-title">Name your strategy</h2><p>This starting point becomes one normal saved strategy. You can move between Summary, Guide, and Flow after creation.</p><label>Strategy name<input autoFocus value={createDraft.name} maxLength={100} onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })} /></label>{createError && <p className="form-error" role="alert">{createError}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreateDraft(null)}>Cancel</button><button className="primary-button" disabled={!createDraft.name.trim() || creating !== null}>{creating ? "Creating…" : "Create strategy"}</button></div></form></div>}
  </AppShell>;
}
