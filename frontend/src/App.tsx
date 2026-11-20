import { useCallback, useEffect, useRef, useState } from "react";
import { loadEditorBootstrap } from "./api";
import { AppShell } from "./components/AppShell";
import type { EditorBootstrap } from "./domain/canonical";
import { findExample, type ExampleId, type StrategyExample } from "./domain/examples";
import { pathForRoute, routeFromPath, type AppRoute } from "./domain/navigation";
import { v2AuthoringApi } from "./v2AuthoringApi";
import { strategyApi, type StrategyDetail, type StrategyDetailV1, type StrategyRecord } from "./strategyApi";
import { ExploreView } from "./views/ExploreView";
import { HomeView } from "./views/HomeView";
import { PublicView } from "./views/PublicView";
import { CreationPicker } from "./components/CreationPicker";
import { CatalogStrategyDialog } from "./components/CatalogStrategyDialog";
import { strategyCatalogApi, type CatalogStrategyRequest, type StrategyCatalogEntry } from "./strategyCatalogApi";
import { backtestRunApi, type BacktestRunRecord } from "./backtestRunApi";
import { ResultWorkspace } from "./components/ResultWorkspace";
import type { ResearchContext } from "./domain/researchContext";
import { ComparisonWorkspace } from "./components/ComparisonWorkspace";
import { StrategyWorkspaceEditor } from "./components/StrategyWorkspaceEditor";
import { challengeApi, type ChallengeDefinition } from "./challengeApi";
import { ChallengeHubDialog } from "./components/ChallengeHubDialog";
import { ChallengeSubmissionView } from "./components/ChallengeSubmissionView";

type LoadState = "idle" | "loading" | "loaded" | "error";
export type StrategyWorkspace = { bootstrap: EditorBootstrap; example: StrategyExample; detail?: StrategyDetail; initialView?: "overview" | "guided" };

export function workspaceFromCreatedStrategy(
  detail: StrategyDetailV1,
  bootstrap: EditorBootstrap,
  example: StrategyExample,
  initialView: "overview" | "guided" = "overview",
): StrategyWorkspace {
  return {
    bootstrap: { ...bootstrap, strategy: detail.current_revision.canonical_strategy },
    example,
    detail,
    initialView,
  };
}

export function routeForCreatedStrategy(detail: StrategyDetail): AppRoute {
  return { page: "strategy", strategyId: detail.strategy.id };
}

export function workspaceFromPersistedStrategy(
  detail: StrategyDetail,
  registryBootstrap: EditorBootstrap,
): StrategyWorkspace {
  const bootstrap: EditorBootstrap = {
    ...registryBootstrap,
    strategy: detail.current_revision.canonical_strategy as EditorBootstrap["strategy"],
    validation: { valid: true, issues: [] },
  };
  return { bootstrap, example: defaultsFor(bootstrap), detail };
}

export function StrategyLoadError({ message, onHome }: { message: string; onHome: () => void }) {
  return <div className="page-state error-state" role="alert"><h1>We couldn't open this strategy</h1><p>{message}</p><button className="primary-button" onClick={onHome}>Back to My Strategies</button></div>;
}

function defaultsFor(bootstrap: EditorBootstrap): StrategyExample {
  if ((bootstrap.strategy as { api_version?: string }).api_version === "ruletrade.dev/strategy/v2") return findExample("sleeves")!;
  const cooldown = bootstrap.strategy.graph.components.some((item) => item.primitive.toLowerCase().includes("cooldown"));
  return findExample(cooldown ? "cooldown" : "sleeves")!;
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname, window.location.search));
  const [workspace, setWorkspace] = useState<StrategyWorkspace | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<LoadState>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [listStatus, setListStatus] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [createDraft, setCreateDraft] = useState<{ id: ExampleId; bootstrap: EditorBootstrap; name: string; initialView: "overview" | "guided" } | null>(null);
  const [programDraftName, setProgramDraftName] = useState<string | null>(null);
  const [programCreating, setProgramCreating] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogChallenge, setCatalogChallenge] = useState<ChallengeDefinition | null>(null);
  const [catalogEntries, setCatalogEntries] = useState<StrategyCatalogEntry[]>([]);
  const [catalogCreating, setCatalogCreating] = useState(false);
  const [creating, setCreating] = useState<ExampleId | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdDestination, setCreatedDestination] = useState<{ strategyId: string; workspace: StrategyWorkspace } | null>(null);
  const [historicalRun, setHistoricalRun] = useState<BacktestRunRecord | null>(null);
  const [runStatus, setRunStatus] = useState<LoadState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [sourceFocus, setSourceFocus] = useState<{ revisionId: string; componentId: string; fieldPath?: string | null; researchContext?: ResearchContext; returnRoute?: AppRoute } | null>(null);
  const [researchContext, setResearchContext] = useState<ResearchContext | null>(null);
  const [comparisonContext, setComparisonContext] = useState<{ comparisonId: string; context: ResearchContext } | null>(null);
  const [adoptionNotice, setAdoptionNotice] = useState<string | null>(null);
  const [challengeIteration, setChallengeIteration] = useState<{ challengeId: string; challengeKind: "learning" | "competition"; strategyId: string; attemptId: string; feedback: string[] } | null>(null);
  const [challengeLaunch, setChallengeLaunch] = useState<{ token: number; challengeId: string; strategyId: string } | null>(null);
  const creationInFlight = useRef(false);

  const navigate = useCallback((next: AppRoute, preserveFocus = false) => {
    if (dirty && route.page === "builder" && next.page !== "builder" && !window.confirm("Leave with unsaved strategy changes? They will be lost.")) return false;
    if (!preserveFocus) setSourceFocus(null);
    if (next.page !== "builder") setAdoptionNotice(null);
    window.history.pushState(null, "", pathForRoute(next)); setRoute(next); if (next.page !== "builder") setDirty(false); return true;
  }, [dirty, route.page]);

  useEffect(() => { const onPopState = () => setRoute(routeFromPath(window.location.pathname, window.location.search)); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => { const onBeforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", onBeforeUnload); return () => window.removeEventListener("beforeunload", onBeforeUnload); }, [dirty]);

  const loadList = useCallback(async () => {
    setListStatus("loading"); setListError(null);
    try { const result = await strategyApi.list(); setStrategies(result.items); setListStatus("loaded"); }
    catch (reason) { setListError(reason instanceof Error ? reason.message : "The backend is unavailable."); setListStatus("error"); }
  }, []);
  useEffect(() => { if (["home", "strategies", "explore", "example", "learning", "learningProblem", "competitions", "competition"].includes(route.page)) void loadList(); }, [route.page, loadList]);

  useEffect(() => {
    if (route.page !== "run") return;
    let cancelled = false; const runId = route.runId; setRunStatus("loading"); setRunError(null); setHistoricalRun(null);
    backtestRunApi.getV2(runId).then((run) => { if (!cancelled) { setHistoricalRun(run); setRunStatus("loaded"); } }).catch((reason: unknown) => { if (!cancelled) { setRunError(reason instanceof Error ? reason.message : "We couldn't load this backtest."); setRunStatus("error"); } });
    return () => { cancelled = true; };
  }, [route]);

  useEffect(() => {
    const strategyRoute = route.page === "strategy" || route.page === "builder" || route.page === "research" ? route : null;
    if (route.page !== "example" && !strategyRoute) return;
    if (strategyRoute && createdDestination && createdDestination.strategyId === strategyRoute.strategyId) {
      setWorkspace(createdDestination.workspace);
      setWorkspaceStatus("loaded");
      setWorkspaceError(null);
      setDirty(false);
      setCreatedDestination(null);
      return;
    }
    let cancelled = false; const controller = new AbortController(); setWorkspaceStatus("loading"); setWorkspaceError(null); setWorkspace(null); setDirty(false);
    const task = route.page === "example"
      ? (() => { const exampleId = route.exampleId; return loadEditorBootstrap(exampleId).then((bootstrap) => ({ bootstrap, example: findExample(exampleId)! })); })()
      : (() => { const strategyId = strategyRoute!.strategyId; return Promise.all([strategyApi.get(strategyId, undefined, controller.signal), loadEditorBootstrap("sleeves")]).then(([detail, registryBootstrap]) => {
          return workspaceFromPersistedStrategy(detail, registryBootstrap);
        }); })();
    task.then((value) => { if (!cancelled) { setWorkspace(value); setWorkspaceStatus("loaded"); } }).catch((reason: unknown) => { if (!cancelled) { setWorkspaceError(reason instanceof Error ? reason.message : String(reason)); setWorkspaceStatus("error"); } });
    return () => { cancelled = true; controller.abort(); };
  }, [route]);

  function rememberStrategy(record: StrategyRecord) {
    setStrategies((current) => [record, ...current.filter((item) => item.id !== record.id)]);
  }

  async function beginCreate(id: ExampleId) {
    if (creationInFlight.current) return;
    creationInFlight.current = true;
    setCreating(id); setCreateError(null);
    try { const point = findExample(id)!; const bootstrap = await loadEditorBootstrap(id); setCreateDraft({ id, bootstrap, name: point.title, initialView: point.kind === "example" ? "overview" : point.initialView }); setPickerOpen(false); }
    catch (reason) { setCreateError(reason instanceof Error ? reason.message : "We couldn't load this starting point."); setPickerOpen(true); }
    finally { creationInFlight.current = false; setCreating(null); }
  }

  async function confirmCreate() {
    if (!createDraft?.name.trim() || creationInFlight.current) return;
    creationInFlight.current = true;
    setCreating(createDraft.id);
    try {
      const draft = createDraft;
      const canonical = await v2AuthoringApi.programTemplate(draft.name.trim(), ["SPY"], fetch, draft.id);
      const detail = await strategyApi.create(draft.name.trim(), canonical);
      rememberStrategy(detail.strategy);
      setCreateDraft(null);
      navigate(routeForCreatedStrategy(detail));
    }
    catch (reason) { setCreateError(reason instanceof Error ? reason.message : "We couldn't create this strategy."); }
    finally { creationInFlight.current = false; setCreating(null); }
  }

  async function openCatalogCreate(challenge: ChallengeDefinition | null = null) {
    setPickerOpen(false); setCreateError(null); setCatalogChallenge(challenge);
    try {
      const entries = await strategyCatalogApi.list();
      setCatalogEntries(entries);
      setCatalogOpen(true);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "We couldn't load the tested strategy rules.");
      setPickerOpen(true);
    }
  }

  async function confirmCatalogCreate(request: CatalogStrategyRequest) {
    if (creationInFlight.current) return;
    creationInFlight.current = true; setCatalogCreating(true); setCreateError(null);
    try {
      const created = await strategyCatalogApi.create(request);
      const detail = await strategyApi.create(request.name, created.strategy);
      rememberStrategy(detail.strategy);
      setCatalogOpen(false);
      const challenge = catalogChallenge;
      const attempt = challenge
        ? await challengeApi.startAttempt(challenge.id, detail.strategy.id)
        : null;
      if (challenge && attempt) {
        setChallengeIteration({
          challengeId: challenge.id,
          challengeKind: challenge.kind,
          strategyId: detail.strategy.id,
          attemptId: attempt.id,
          feedback: [],
        });
      }
      setCatalogChallenge(null);
      navigate(challenge && attempt ? {
        page: "builder",
        strategyId: detail.strategy.id,
        challenge: { kind: challenge.kind, challengeId: challenge.id, attemptId: attempt.id },
      } : routeForCreatedStrategy(detail));
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "We couldn't create this strategy.");
    } finally {
      creationInFlight.current = false; setCatalogCreating(false);
    }
  }

  async function confirmProgramCreate() {
    if (!programDraftName?.trim() || creationInFlight.current) return;
    creationInFlight.current = true; setProgramCreating(true); setCreateError(null);
    try {
      const canonical = await v2AuthoringApi.programTemplate(programDraftName.trim());
      const detail = await strategyApi.create(programDraftName.trim(), canonical);
      rememberStrategy(detail.strategy);
      setProgramDraftName(null); setPickerOpen(false); navigate(routeForCreatedStrategy(detail));
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "We couldn't create this strategy.");
    } finally {
      creationInFlight.current = false; setProgramCreating(false);
    }
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
      setResearchContext(context); setSourceFocus({ revisionId, componentId, fieldPath, researchContext: context, returnRoute }); navigate({ page: "strategy", strategyId: owner.id }, true);
    } catch (reason) { setRunError(reason instanceof Error ? reason.message : "We couldn't open the strategy rule."); }
  }

  const builderChallenge = route.page === "builder"
    ? route.challenge ?? (challengeIteration?.strategyId === route.strategyId ? { kind: challengeIteration.challengeKind, challengeId: challengeIteration.challengeId, attemptId: challengeIteration.attemptId } : undefined)
    : undefined;
  const builderFeedback = route.page === "builder" && challengeIteration?.strategyId === route.strategyId && builderChallenge?.challengeId === challengeIteration.challengeId
    ? challengeIteration.feedback
    : [];
  const strategyName = workspace?.detail?.strategy.name ?? (route.page === "example" ? findExample(route.exampleId)?.title : undefined);
  const recent = [...strategies].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const openPicker = () => { setCreateError(null); setPickerOpen(true); };
  const chooseStartingPoint = (id: ExampleId) => { setPickerOpen(false); void beginCreate(id); };
  return <AppShell route={route} strategyName={strategyName} recent={recent} navigate={navigate} onCreate={openPicker}>
    {route.page === "public" && <PublicView onExample={(exampleId) => void beginCreate(exampleId)} onHome={() => navigate({ page: "home" })} onCreate={openPicker} />}
    {(route.page === "home" || route.page === "strategies") && <HomeView context={route.page} status={listStatus === "idle" ? "loading" : listStatus} strategies={strategies} error={listError} onOpen={(strategyId) => navigate({ page: "strategy", strategyId })} onLearning={() => navigate({ page: "learning" })} onCompetition={() => navigate({ page: "competitions" })} onRetry={() => void loadList()} onCreate={openPicker} onExample={(exampleId) => void beginCreate(exampleId)} />}
    {route.page === "explore" && <ExploreView onOpen={(exampleId) => void beginCreate(exampleId)} onCreate={openPicker} />}
    {(route.page === "example" || route.page === "strategy" || route.page === "builder" || route.page === "research") && workspaceStatus === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening strategy…</h1><p>Loading its saved rules.</p></div>}
    {(route.page === "example" || route.page === "strategy" || route.page === "builder" || route.page === "research") && workspaceStatus === "error" && <StrategyLoadError message={workspaceError ?? "This strategy is unavailable."} onHome={() => navigate({ page: "home" })} />}
    {route.page === "example" && workspace && workspaceStatus === "loaded" && <section className="page legacy-example-entry"><span className="eyebrow">Example</span><h1>{workspace.example.title}</h1><p>This link now starts an ordinary saved Strategy in the shared Builder.</p><div className="dialog-actions"><button className="secondary-button" onClick={() => navigate({ page: "explore" })}>Back to Explore</button><button className="primary-button" onClick={() => void beginCreate(workspace.example.id)}>Continue</button></div></section>}
    {(route.page === "strategy" || route.page === "builder" || route.page === "research") && workspace && workspaceStatus === "loaded" && workspace.detail && <>
      {route.page === "builder" && builderChallenge && <aside className="challenge-iteration-banner" aria-label="Challenge iteration">
        <div><span className="eyebrow">Problem submission draft</span><strong>Revise this strategy, save a new Revision, then return to the problem page to submit it.</strong>{builderFeedback.length > 0 && <ul>{builderFeedback.map((item) => <li key={item}>{item}</li>)}</ul>}</div>
        <button type="button" className="primary-button" onClick={() => navigate(builderChallenge.kind === "learning"
          ? { page: "learningProblem", problemId: builderChallenge.challengeId, strategyId: route.strategyId, attemptId: builderChallenge.attemptId }
          : { page: "competition", competitionId: builderChallenge.challengeId, strategyId: route.strategyId, attemptId: builderChallenge.attemptId }
        )}>Return to problem</button>
      </aside>}
      <StrategyWorkspaceEditor
        bootstrap={workspace.bootstrap} example={workspace.example} detail={workspace.detail}
        surface={route.page === "builder" ? "builder" : route.page === "research" ? "research" : "detail"}
        initialView={workspace.initialView ?? "overview"} confirmation={adoptionNotice}
        onDirtyChange={setDirty}
        onOpenStrategy={() => navigate({ page: "strategy", strategyId: workspace.detail!.strategy.id })}
        onOpenBuilder={() => navigate({ page: "builder", strategyId: workspace.detail!.strategy.id })}
        onOpenResearch={() => navigate({ page: "research", strategyId: workspace.detail!.strategy.id })}
        sourceFocus={sourceFocus}
        onOpenRun={(runId) => navigate({ page: "run", runId })}
      />
    </>}
    {(["learning", "learningProblem", "competitions", "competition"] as const).includes(route.page as "learning" | "learningProblem" | "competitions" | "competition") && <ChallengeHubDialog
      presentation="page"
      kind={route.page === "learning" || route.page === "learningProblem" ? "learning" : "competition"}
      listOnly={route.page === "learning" || route.page === "competitions"}
      strategies={recent}
      initialChallengeId={route.page === "learningProblem" ? route.problemId : route.page === "competition" ? route.competitionId : challengeLaunch?.challengeId}
      initialStrategyId={route.page === "learningProblem" || route.page === "competition" ? route.strategyId : challengeLaunch?.strategyId}
      initialAttemptId={route.page === "learningProblem" || route.page === "competition" ? route.attemptId : undefined}
      onClose={() => navigate(route.page === "learningProblem" ? { page: "learning" } : route.page === "competition" ? { page: "competitions" } : { page: "home" })}
      onSelectChallenge={(challenge) => navigate(challenge.kind === "learning" ? { page: "learningProblem", problemId: challenge.id } : { page: "competition", competitionId: challenge.id })}
      onCreateStrategy={(challenge) => void openCatalogCreate(challenge)}
      onOpenStrategy={(strategyId) => navigate({ page: "strategy", strategyId })}
      onOpenRun={(runId) => navigate({ page: "run", runId })}
      onOpenSubmission={(submissionId) => navigate({ page: "submission", submissionId })}
      onReviseStrategy={(strategyId, challengeId, feedback) => {
        void (async () => {
          const challengeKind = route.page === "learning" || route.page === "learningProblem" ? "learning" : "competition";
          try {
            const attempt = await challengeApi.startAttempt(challengeId, strategyId);
            setChallengeIteration({ strategyId, challengeId, challengeKind, attemptId: attempt.id, feedback });
            navigate({
              page: "builder",
              strategyId,
              challenge: { kind: challengeKind, challengeId, attemptId: attempt.id },
            });
          } catch (reason) {
            setCreateError(reason instanceof Error ? reason.message : "We couldn't start this attempt.");
          }
        })();
      }}
    />}
    {route.page === "submission" && <ChallengeSubmissionView
      submissionId={route.submissionId}
      onBack={() => window.history.back()}
      onOpenChallenge={(challenge, strategyId) => navigate(challenge.kind === "learning"
        ? { page: "learningProblem", problemId: challenge.id, strategyId }
        : { page: "competition", competitionId: challenge.id, strategyId }
      )}
      onOpenRun={(runId) => navigate({ page: "run", runId })}
      onOpenStrategy={(strategyId) => navigate({ page: "strategy", strategyId })}
    />}
    {route.page === "run" && runStatus === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h1>Opening saved backtest…</h1><p>Loading the historical result without running it again.</p></div>}
    {route.page === "run" && runStatus === "error" && <div className="page-state error-state" role="alert"><h1>We couldn't open this backtest</h1><p>{runError}</p><button className="primary-button" onClick={() => navigate({ page: "home" })}>Back to My Strategies</button></div>}
    {route.page === "run" && runStatus === "loaded" && historicalRun && <ResultWorkspace key={historicalRun.id} run={historicalRun} strategyName={historicalRun.candidate_id ? "Candidate result" : "Historical backtest"} onBack={() => window.history.back()} researchContext={researchContext?.runId === historicalRun.id ? researchContext : null} onResearchContextChange={setResearchContext} onShowInStrategy={(revisionId, componentId, fieldPath, context) => void showInStrategy(revisionId, componentId, fieldPath, context)} onComparisonReady={(comparison, context) => { setResearchContext(context); setComparisonContext({ comparisonId: comparison.id, context }); navigate({ page: "comparison", comparisonId: comparison.id }); }} />}
    {route.page === "comparison" && <ComparisonWorkspace comparisonId={route.comparisonId} initialContext={comparisonContext?.comparisonId === route.comparisonId ? comparisonContext.context : null} onContextChange={(context) => setComparisonContext({ comparisonId: route.comparisonId, context })} onOpenRun={(runId, context) => { if (context) { setResearchContext(context); setComparisonContext({ comparisonId: route.comparisonId, context }); } navigate({ page: "run", runId }); }} onViewRule={(revisionId, componentId, fieldPath, context) => void showInStrategy(revisionId, componentId, fieldPath, context, { page: "comparison", comparisonId: route.comparisonId })} onAdopted={(response) => { setAdoptionNotice("This change is now part of your strategy."); setSourceFocus(null); navigate({ page: "strategy", strategyId: response.strategy.id }); }} onOpenLatest={(revisionId) => { setAdoptionNotice(null); void openStrategyOwningRevision(revisionId).catch((reason: unknown) => setRunError(reason instanceof Error ? reason.message : "We couldn't open the latest strategy.")); }} />}
    {pickerOpen && <CreationPicker onChoose={chooseStartingPoint} onCatalog={() => void openCatalogCreate()} onProgram={() => { setPickerOpen(false); setProgramDraftName("Untitled Strategy"); }} onClose={() => setPickerOpen(false)} loading={creating} error={createError} />}
    {catalogOpen && <CatalogStrategyDialog entries={catalogEntries} loading={catalogCreating} error={createError} challenge={catalogChallenge} onClose={() => { setCatalogOpen(false); setCatalogChallenge(null); setCreateError(null); }} onCreate={(request) => void confirmCatalogCreate(request)} />}
    {createDraft && <div className="modal-backdrop" role="presentation"><form className="create-dialog" aria-labelledby="create-title" onSubmit={(event) => { event.preventDefault(); void confirmCreate(); }}><span className="eyebrow">New strategy</span><h2 id="create-title">Name your strategy</h2><p>This starting point becomes one normal saved strategy. You can move between Summary, Guide, and Flow after creation.</p><label>Strategy name<input autoFocus value={createDraft.name} maxLength={100} onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })} /></label>{createError && <p className="form-error" role="alert">{createError}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreateDraft(null)}>Cancel</button><button className="primary-button" disabled={!createDraft.name.trim() || creating !== null}>{creating ? "Creating…" : "Create strategy"}</button></div></form></div>}
    {programDraftName !== null && <div className="modal-backdrop" role="presentation"><form className="create-dialog" aria-labelledby="program-create-title" onSubmit={(event) => { event.preventDefault(); void confirmProgramCreate(); }}><span className="eyebrow">New strategy</span><h2 id="program-create-title">Name your strategy</h2><p>You will start in the normal Builder with an empty canvas and context-aware next steps.</p><label>Strategy name<input autoFocus value={programDraftName} maxLength={100} onChange={(event) => setProgramDraftName(event.target.value)} /></label>{createError && <p className="form-error" role="alert">{createError}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setProgramDraftName(null)}>Cancel</button><button className="primary-button" disabled={!programDraftName.trim() || programCreating}>{programCreating ? "Creating…" : "Create strategy"}</button></div></form></div>}
  </AppShell>;
}
