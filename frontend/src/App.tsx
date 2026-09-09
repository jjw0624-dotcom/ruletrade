import { useEffect, useState } from "react";
import { loadEditorBootstrap } from "./api";
import { AppShell } from "./components/AppShell";
import type { EditorBootstrap } from "./domain/canonical";
import { findExample } from "./domain/examples";
import { pathForRoute, routeFromPath, type AppRoute } from "./domain/navigation";
import { StrategyEditor } from "./StrategyEditor";
import { StrategyEditorProvider } from "./store/editorStore";
import { ExploreView } from "./views/ExploreView";
import { StrategiesView } from "./views/StrategiesView";

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));
  const [bootstrap, setBootstrap] = useState<EditorBootstrap | null>(null);
  const [loadedExampleId, setLoadedExampleId] = useState<string | null>(null);
  const [loadingExample, setLoadingExample] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function navigate(next: AppRoute) { window.history.pushState(null, "", pathForRoute(next)); setRoute(next); }
  useEffect(() => { const onPopState = () => setRoute(routeFromPath(window.location.pathname)); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  useEffect(() => {
    if (route.page !== "strategy") return;
    if (route.exampleId === loadedExampleId && bootstrap) return;
    setLoadingExample(route.exampleId); setError(null);
    loadEditorBootstrap(route.exampleId).then((payload) => { setBootstrap(payload); setLoadedExampleId(route.exampleId); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoadingExample(null));
  }, [route, loadedExampleId, bootstrap]);
  const activeExample = route.page === "strategy" ? findExample(route.exampleId) : undefined;
  return <AppShell route={route} strategyName={activeExample?.title} navigate={navigate}>
    {route.page === "explore" && <ExploreView onOpen={(exampleId) => navigate({ page: "strategy", exampleId })} />}
    {route.page === "strategies" && <StrategiesView onExplore={() => navigate({ page: "explore" })} />}
    {route.page === "strategy" && loadingExample && <div className="page-state"><span className="loading-spinner" /><h1>Opening strategy…</h1><p>Loading the backend-owned strategy model.</p></div>}
    {route.page === "strategy" && error && <div className="page-state error-state"><h1>We couldn't open this strategy</h1><p>{error}</p><button className="primary-button" onClick={() => navigate({ page: "explore" })}>Back to Explore</button></div>}
    {bootstrap && loadedExampleId && findExample(loadedExampleId) && <div className={route.page === "strategy" && route.exampleId === loadedExampleId && !loadingExample && !error ? "" : "hidden"}><StrategyEditorProvider key={loadedExampleId} bootstrap={bootstrap}><StrategyEditor example={findExample(loadedExampleId)!} /></StrategyEditorProvider></div>}
  </AppShell>;
}
