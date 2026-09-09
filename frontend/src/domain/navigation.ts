import type { ExampleId } from "./examples";

export type AppRoute = { page: "explore" } | { page: "strategies" } | { page: "example"; exampleId: ExampleId } | { page: "strategy"; strategyId: string };

export function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/strategies") return { page: "strategies" };
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
  return "/explore";
}
