import type { ExampleId } from "./examples";

export type ChallengeKind = "learning" | "competition";
export type ChallengeContext = { kind: ChallengeKind; challengeId: string; attemptId?: string };

export type AppRoute =
  | { page: "public" }
  | { page: "home" }
  | { page: "strategies" }
  | { page: "explore" }
  | { page: "learning" }
  | { page: "learningProblem"; problemId: string; strategyId?: string; attemptId?: string }
  | { page: "competitions" }
  | { page: "competition"; competitionId: string; strategyId?: string; attemptId?: string }
  | { page: "submission"; submissionId: string }
  | { page: "example"; exampleId: ExampleId }
  | { page: "strategy"; strategyId: string }
  | { page: "builder"; strategyId: string; challenge?: ChallengeContext }
  | { page: "research"; strategyId: string }
  | { page: "run"; runId: string }
  | { page: "comparison"; comparisonId: string };

function contextFromSearch(search: string): { strategyId?: string; attemptId?: string } {
  const params = new URLSearchParams(search);
  return {
    strategyId: params.get("strategy") || undefined,
    attemptId: params.get("attempt") || undefined,
  };
}

export function routeFromPath(pathname: string, search = ""): AppRoute {
  if (pathname === "/") return { page: "public" };
  if (pathname === "/home") return { page: "home" };
  if (pathname === "/strategies") return { page: "strategies" };
  if (pathname === "/explore") return { page: "explore" };
  if (pathname === "/learning") return { page: "learning" };
  const learningProblem = pathname.match(/^\/learning\/problems\/([^/]+)$/);
  if (learningProblem) return { page: "learningProblem", problemId: decodeURIComponent(learningProblem[1]), ...contextFromSearch(search) };
  if (pathname === "/competitions") return { page: "competitions" };
  const competition = pathname.match(/^\/competitions\/([^/]+)$/);
  if (competition) return { page: "competition", competitionId: decodeURIComponent(competition[1]), ...contextFromSearch(search) };
  const submission = pathname.match(/^\/submissions\/([^/]+)$/);
  if (submission) return { page: "submission", submissionId: decodeURIComponent(submission[1]) };
  const run = pathname.match(/^\/backtest-runs\/([^/]+)$/);
  if (run) return { page: "run", runId: decodeURIComponent(run[1]) };
  const comparison = pathname.match(/^\/comparisons\/([^/]+)$/);
  if (comparison) return { page: "comparison", comparisonId: decodeURIComponent(comparison[1]) };
  const builder = pathname.match(/^\/strategies\/([^/]+)\/builder$/);
  if (builder) {
    const params = new URLSearchParams(search);
    const kind = params.get("challengeKind");
    const challengeId = params.get("challengeId");
    const challenge: ChallengeContext | undefined = (kind === "learning" || kind === "competition") && challengeId ? { kind: kind as ChallengeKind, challengeId, attemptId: params.get("attemptId") || undefined } : undefined;
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

function withProblemContext(path: string, strategyId?: string, attemptId?: string): string {
  const params: string[] = [];
  if (strategyId) params.push(`strategy=${encodeURIComponent(strategyId)}`);
  if (attemptId) params.push(`attempt=${encodeURIComponent(attemptId)}`);
  return params.length ? `${path}?${params.join("&")}` : path;
}

export function pathForRoute(route: AppRoute): string {
  if (route.page === "public") return "/";
  if (route.page === "home") return "/home";
  if (route.page === "strategies") return "/strategies";
  if (route.page === "learning") return "/learning";
  if (route.page === "learningProblem") return withProblemContext(`/learning/problems/${encodeURIComponent(route.problemId)}`, route.strategyId, route.attemptId);
  if (route.page === "competitions") return "/competitions";
  if (route.page === "competition") return withProblemContext(`/competitions/${encodeURIComponent(route.competitionId)}`, route.strategyId, route.attemptId);
  if (route.page === "submission") return `/submissions/${encodeURIComponent(route.submissionId)}`;
  if (route.page === "example") return `/strategy/${route.exampleId}`;
  if (route.page === "strategy") return `/strategies/${encodeURIComponent(route.strategyId)}`;
  if (route.page === "builder") {
    const path = `/strategies/${encodeURIComponent(route.strategyId)}/builder`;
    if (!route.challenge) return path;
    const params = new URLSearchParams({ challengeKind: route.challenge.kind, challengeId: route.challenge.challengeId });
    if (route.challenge.attemptId) params.set("attemptId", route.challenge.attemptId);
    return `${path}?${params.toString()}`;
  }
  if (route.page === "research") return `/strategies/${encodeURIComponent(route.strategyId)}/research`;
  if (route.page === "run") return `/backtest-runs/${encodeURIComponent(route.runId)}`;
  if (route.page === "comparison") return `/comparisons/${encodeURIComponent(route.comparisonId)}`;
  return "/explore";
}
