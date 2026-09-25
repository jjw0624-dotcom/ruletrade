import type { BacktestRunRecord } from "../backtestRunApi";
import { decisionEvidenceApi, type DecisionEventDetail, type DecisionEventSummary } from "../decisionEvidenceApi";
import { relevantAssets } from "./decisionPresentation";
import type { ResearchContext } from "./researchContext";

export interface RuleEvidenceTarget {
  componentId: string;
  fieldPath?: string | null;
}

export interface RuleEvidenceMatch {
  runId: string;
  revisionId: string;
  sessionId: string;
  eventIds: string[];
  kinds: DecisionEventSummary["kind"][];
  assets: string[];
  runCreatedAt: string;
  requestedPeriod: string;
}

export function eventMatchesRule(
  event: Pick<DecisionEventSummary, "source_components">,
  target: RuleEvidenceTarget,
): boolean {
  return event.source_components.some((source) =>
    source.component_id === target.componentId
    && (!target.fieldPath || source.field_path === target.fieldPath),
  );
}

export async function loadRuleEvidenceMatches(
  runs: BacktestRunRecord[],
  revisionId: string,
  target: RuleEvidenceTarget,
  fetcher: typeof fetch = fetch,
): Promise<RuleEvidenceMatch[]> {
  const eligible = runs.filter((run) =>
    run.revision_id === revisionId
    && run.status === "succeeded"
    && !run.candidate_id,
  );
  const perRun = await Promise.all(eligible.map(async (run) => {
    const summaries = (await decisionEvidenceApi.list(run.id, fetcher)).items
      .filter((event) => eventMatchesRule(event, target));
    const bySession = new Map<string, DecisionEventSummary[]>();
    for (const event of summaries) {
      bySession.set(event.session_id, [...(bySession.get(event.session_id) ?? []), event]);
    }
    return await Promise.all([...bySession].map(async ([sessionId, events]) => {
      const details = await Promise.all(
        events.map((event) => decisionEvidenceApi.get(run.id, event.id, fetcher)),
      );
      return matchFromDetails(run, sessionId, events, details);
    }));
  }));
  return perRun.flat().sort((a, b) =>
    b.sessionId.localeCompare(a.sessionId)
    || b.runCreatedAt.localeCompare(a.runCreatedAt),
  );
}

function matchFromDetails(
  run: BacktestRunRecord,
  sessionId: string,
  events: DecisionEventSummary[],
  details: DecisionEventDetail[],
): RuleEvidenceMatch {
  return {
    runId: run.id,
    revisionId: run.revision_id,
    sessionId,
    eventIds: events.map((event) => event.id),
    kinds: [...new Set(events.map((event) => event.kind))],
    assets: relevantAssets(details),
    runCreatedAt: run.created_at,
    requestedPeriod: `${run.run_config.start_date} – ${run.run_config.end_date}`,
  };
}

export function researchContextForMatch(
  match: RuleEvidenceMatch,
  asset: string | null,
): ResearchContext {
  return {
    runId: match.runId,
    sessionId: match.sessionId,
    decisionId: match.eventIds[0],
    asset: asset && match.assets.includes(asset) ? asset : null,
  };
}
