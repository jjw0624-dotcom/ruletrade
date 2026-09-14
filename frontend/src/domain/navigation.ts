import type { ExampleId } from "./examples";

export type AppRoute = { page: "public" } | { page: "home" } | { page: "strategies" } | { page: "explore" } | { page: "example"; exampleId: ExampleId } | { page: "strategy"; strategyId: string } | { page: "run"; runId: string } | { page: "comparison"; comparisonId: string };

export function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/") return { page: "public" };
  if (pathname === "/home") return { page: "home" };
  if (pathname === "/strategies") return { page: "strategies" };
  if (pathname === "/explore") return { page: "explore" };
  const run = pathname.match(/^\/backtest-runs\/([^/]+)$/);
  if (run) return { page: "run", runId: decodeURIComponent(run[1]) };
  const comparison = pathname.match(/^\/comparisons\/([^/]+)$/);
  if (comparison) return { page: "comparison", comparisonId: decodeURIComponent(comparison[1]) };
  const persisted = pathname.match(/^\/strategies\/([^/]+)$/);
  if (persisted) return { page: "strategy", strategyId: decodeURIComponent(persisted[1]) };
  const match = pathname.match(/^\/strategy\/([^/]+)$/);
  if (match && ["sleeves", "fallback", "cooldown", "one_investment", "filter", "golden"].includes(match[1])) {
    return { page: "example", exampleId: match[1] as ExampleId };
  }
  return { page: "public" };
}

export function pathForRoute(route: AppRoute): string {
  if (route.page === "public") return "/";
  if (route.page === "home") return "/home";
  if (route.page === "strategies") return "/strategies";
  if (route.page === "example") return `/strategy/${route.exampleId}`;
  if (route.page === "strategy") return `/strategies/${encodeURIComponent(route.strategyId)}`;
  if (route.page === "run") return `/backtest-runs/${encodeURIComponent(route.runId)}`;
  if (route.page === "comparison") return `/comparisons/${encodeURIComponent(route.comparisonId)}`;
  return "/explore";
}
