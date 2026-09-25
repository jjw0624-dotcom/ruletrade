import type { DecisionEventSummary } from "../decisionEvidenceApi";
import type { BacktestResult } from "./backtest";
import { groupDecisionSessions } from "./decisionPresentation";

export type ResultEventCategory = "selection" | "fallback" | "eligibility" | "portfolio";
export type ResultEventFilter = "all" | ResultEventCategory;

export interface ResultEventPresentation {
  key: string;
  runId: string;
  decisionId: string;
  decisionIds: string[];
  sessionId: string;
  category: ResultEventCategory;
  label: string;
  summaries: DecisionEventSummary[];
}

export interface ResultChartPoint { time: string; value: number }

export function projectResultChartSeries(result: BacktestResult): ResultChartPoint[] {
  return result.equity_curve.map((point) => ({ time: point.timestamp.slice(0, 10), value: Number(point.value) }));
}

export function resultEventsOnSeries(events: ResultEventPresentation[], series: ResultChartPoint[]): ResultEventPresentation[] {
  const times = new Set(series.map((point) => point.time));
  return events.filter((event) => times.has(event.sessionId));
}

const categoryPriority: ResultEventCategory[] = ["fallback", "eligibility", "selection", "portfolio"];

function categoryFor(items: DecisionEventSummary[]): ResultEventCategory {
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.has("fallback")) return "fallback";
  if (kinds.has("cooldown")) return "eligibility";
  if (kinds.has("filter") || kinds.has("selection") || kinds.has("random_selection") || kinds.has("final_selection")) return "selection";
  return "portfolio";
}

function representative(items: DecisionEventSummary[], category: ResultEventCategory): DecisionEventSummary {
  const preferred: Record<ResultEventCategory, DecisionEventSummary["kind"][]> = {
    fallback: ["fallback", "final_selection"],
    eligibility: ["cooldown"],
    selection: ["selection", "random_selection", "filter", "final_selection"],
    portfolio: ["final_targets", "sleeve_contribution", "snapshot_usage", "snapshot_refresh", "state_mutation"],
  };
  return preferred[category].map((kind) => items.find((item) => item.kind === kind)).find(Boolean) ?? items[0];
}

export function projectResultEvents(runId: string, summaries: DecisionEventSummary[]): ResultEventPresentation[] {
  return groupDecisionSessions([...summaries].sort((a, b) => a.ordinal - b.ordinal)).map((session) => {
    const category = categoryFor(session.events);
    const primary = representative(session.events, category);
    return {
      key: `${runId}:${primary.id}`,
      runId,
      decisionId: primary.id,
      decisionIds: session.events.map((event) => event.id),
      sessionId: session.sessionId,
      category,
      label: session.label,
      summaries: session.events,
    };
  });
}

export function filterResultEvents(events: ResultEventPresentation[], filter: ResultEventFilter): ResultEventPresentation[] {
  return filter === "all" ? events : events.filter((event) => event.category === filter);
}

export function availableResultEventFilters(events: ResultEventPresentation[]): ResultEventFilter[] {
  const present = new Set(events.map((event) => event.category));
  return ["all", ...categoryPriority.filter((category) => present.has(category))];
}

/** Keep the chart legible while the paged list remains the complete accessible index. */
export function chartResultEvents(events: ResultEventPresentation[], selectedDecisionId: string | null, limit = 48): ResultEventPresentation[] {
  if (events.length <= limit) return events;
  const sampled = new Map<string, ResultEventPresentation>();
  const denominator = Math.max(limit - 1, 1);
  for (let index = 0; index < limit; index += 1) {
    const event = events[Math.round((index / denominator) * (events.length - 1))];
    sampled.set(event.decisionId, event);
  }
  const selected = events.find((event) => event.decisionId === selectedDecisionId);
  if (selected && !sampled.has(selected.decisionId)) {
    const removable = [...sampled.keys()].find((id) => id !== events[0].decisionId && id !== events.at(-1)?.decisionId);
    if (removable) sampled.delete(removable);
    sampled.set(selected.decisionId, selected);
  }
  return [...sampled.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

export const RESULT_EVENT_PAGE_SIZE = 20;

export function resultEventPage(events: ResultEventPresentation[], page: number, size = RESULT_EVENT_PAGE_SIZE): ResultEventPresentation[] {
  return events.slice(Math.max(0, page) * size, (Math.max(0, page) + 1) * size);
}

export function pageForDecision(events: ResultEventPresentation[], decisionId: string | null, size = RESULT_EVENT_PAGE_SIZE): number {
  const index = decisionId ? events.findIndex((event) => event.decisionId === decisionId) : -1;
  return index < 0 ? 0 : Math.floor(index / size);
}
