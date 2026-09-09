import type { ExampleId } from "./examples";

export type AppRoute = { page: "explore" } | { page: "strategies" } | { page: "strategy"; exampleId: ExampleId };

export function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/strategies") return { page: "strategies" };
  const match = pathname.match(/^\/strategy\/([^/]+)$/);
  if (match && ["sleeves", "fallback", "cooldown"].includes(match[1])) {
    return { page: "strategy", exampleId: match[1] as ExampleId };
  }
  return { page: "explore" };
}

export function pathForRoute(route: AppRoute): string {
  if (route.page === "strategies") return "/strategies";
  if (route.page === "strategy") return `/strategy/${route.exampleId}`;
  return "/explore";
}
