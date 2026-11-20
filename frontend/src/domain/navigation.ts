import type { ExampleId } from "./examples";

export type ChallengeKind = "learning" | "competition";
export type ChallengeContext = { kind: ChallengeKind; challengeId: string };

export type AppRoute =
  | { page: "public" }
  | { page: "home" }
  | { page: "strategies" }
  | { page: "explore" }
  | { page: "learning" }
  | { page: "learningProblem"; problemId: string; strategyId?: string }
  | { page: "competitions" }
  | { page: "competition"; competitionId: string; strategyId?: string }
  | { page: "example"; exampleId: ExampleId }
  | { page: "strategy"; strategyId: string }
  | { page: "builder"; strategyId: string; challenge?: ChallengeContext }
  | { page: "research"; strategyId: string }
  | { page: "run"; runId: string }
  | { page: "comparison"; comparisonId: string };

function strategyFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get("strategy") || undefined;
}

export function routeFromPath(pathname: string, search = ""): AppRoute {
  if (pathname === "/") return { page: "public" };
  if (pathname === "/home") return { page: "home" };
  if (pathname === "/strategies") return { page: "strategies" };
  if (pathname === "/explore") return { page: "explore" };
  if (pathname === "/learning") return { page: "learning" };
  const learningProblem = pathname.match(/^\/learning\/problems\/([^/]+)$/);
  if (learningProblem) return { page: "learningProblem", problemId: decodeURIComponent(learningProblem[1]), strategyId: strategyFromSearch(search) };
  if (pathname === "/competitions") return { page: "competitions" };
  const competition = pathname.match(/^\/competitions\/([^/]+)$/);
  if (competition) return { page: "competition", competitionId: decodeURIComponent(competition[1]), strategyId: strategyFromSearch(search) };
  const run = pathname.match(/^\/backtest-runs\/([^/]+)$/);
  if (run) return { page: "run", runId: decodeURIComponent(run[1]) };
  const comparison = pathname.match(/^\/comparisons\/([^/]+)$/);
  if (comparison) return { page: "comparison", comparisonId: decodeURIComponent(comparison[1]) };
  const builder = pathname.match(/^\/strategies\/([^/]+)\/builder$/);
  if (builder) {
    const params = new URLSearchParams(search);
    const kind = params.get("challengeKind");
    const challengeId = params.get("challengeId");
    const challenge = (kind === "learning" || kind === "competition") && challengeId ? { kind, challengeId } : undefined;
    return { page: "builder", strategyId: decodeURIComponent(builder[1]), challenge };
  }
  const research = pathname.match(/^\/strategies\/([^/]+)\/research$/);
  if (research) return { page: "research", strategyId: decodeURIComponent(research[1]) };
  const persisted = pathname.match(/^\/strategies\/([^/]+)$/);
  if (persisted) return { page: "strategy", strategyId: decodeURIComponent(persisted[1]) };
  const match = pathname.match(/^\/strategy\/([^/]+)$/);
  if (match && ["sleeves", "fallback", "cooldown", "one_investment", "filter", "golden"].includes(match[1])) {
    return { page: "example", exampleId: match[1] as ExampleId };
  }
  return { page: "public" };
}

function withStrategy(path: string, strategyId?: string): string {
  return strategyId ? `${path}?strategy=${encodeURIComponent(strategyId)}` : path;
}

export function pathForRoute(route: AppRoute): string {
  if (route.page === "public") return "/";
  if (route.page === "home") return "/home";
  if (route.page === "strategies") return "/strategies";
  if (route.page === "learning") return "/learning";
  if (route.page === "learningProblem") return withStrategy(`/learning/problems/${encodeURIComponent(route.problemId)}`, route.strategyId);
  if (route.page === "competitions") return "/competitions";
  if (route.page === "competition") return withStrategy(`/competitions/${encodeURIComponent(route.competitionId)}`, route.strategyId);
  if (route.page === "example") return `/strategy/${route.exampleId}`;
  if (route.page === "strategy") return `/strategies/${encodeURIComponent(route.strategyId)}`;
  if (route.page === "builder") {
    const path = `/strategies/${encodeURIComponent(route.strategyId)}/builder`;
    if (!route.challenge) return path;
    const params = new URLSearchParams({ challengeKind: route.challenge.kind, challengeId: route.challenge.challengeId });
    return `${path}?${params.toString()}`;
  }
  if (route.page === "research") return `/strategies/${encodeURIComponent(route.strategyId)}/research`;
  if (route.page === "run") return `/backtest-runs/${encodeURIComponent(route.runId)}`;
  if (route.page === "comparison") return `/comparisons/${encodeURIComponent(route.comparisonId)}`;
  return "/explore";
}
