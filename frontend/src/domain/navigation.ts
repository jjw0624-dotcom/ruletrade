import type { ExampleId } from "./examples";

export type AppRoute = { page: "explore" } | { page: "strategies" } | { page: "example"; exampleId: ExampleId } | { page: "strategy"; strategyId: string } | { page: "run"; runId: string };

export function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/strategies") return { page: "strategies" };
  const run = pathname.match(/^\/backtest-runs\/([^/]+)$/);
  if (run) return { page: "run", runId: decodeURIComponent(run[1]) };
  const persisted = pathname.match(/^\/strategies\/([^/]+)$/);
  if (persisted) return { page: "strategy", strategyId: decodeURIComponent(persisted[1]) };
  const match = pathname.match(/^\/strategy\/([^/]+)$/);
  if (match && ["sleeves", "fallback", "cooldown"].includes(match[1])) {
    return { page: "example", exampleId: match[1] as ExampleId };
  }
  return { page: "explore" };
}

export function pathForRoute(route: AppRoute): string {
  if (route.page === "strategies") return "/strategies";
  if (route.page === "example") return `/strategy/${route.exampleId}`;
  if (route.page === "strategy") return `/strategies/${encodeURIComponent(route.strategyId)}`;
  if (route.page === "run") return `/backtest-runs/${encodeURIComponent(route.runId)}`;
  return "/explore";
}
