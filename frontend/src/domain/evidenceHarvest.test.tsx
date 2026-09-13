import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BacktestRunRecord } from "../backtestRunApi";
import { RuleEvidenceResults } from "../components/RuleEvidenceHistory";
import type { DecisionEventDetail, DecisionEventSummary } from "../decisionEvidenceApi";
import {
  eventMatchesRule,
  loadRuleEvidenceMatches,
  researchContextForMatch,
} from "./evidenceHarvest";

const target = { componentId: "positive_return", fieldPath: "config.threshold" };

const matchingSummary: DecisionEventSummary = {
  id: "event-filter",
  run_id: "run-1",
  ordinal: 1,
  schema_version: 2,
  session_id: "2024-06-03",
  phase: "evaluation",
  kind: "filter",
  source_components: [
    { role: "filter", component_id: "positive_return", field_path: "config.threshold" },
  ],
};
const unrelatedSummary: DecisionEventSummary = {
  id: "event-selection",
  run_id: "run-1",
  ordinal: 2,
  schema_version: 2,
  session_id: "2024-06-03",
  phase: "selection",
  kind: "selection",
  source_components: [
    { role: "selection", component_id: "top_n", field_path: "config.count" },
  ],
};
const matchingDetail: DecisionEventDetail = {
  ...matchingSummary,
  evidence: {
    kind: "filter",
    operator: "gt",
    threshold: "0",
    decision_universe: ["QQQ", "VGT"],
    evaluations: [
      { asset: "QQQ", observed: "0.12", passed: true, stopping_stage: null },
      { asset: "VGT", observed: "-0.04", passed: false, stopping_stage: "filter" },
    ],
  },
};

function run(overrides: Partial<BacktestRunRecord> = {}): BacktestRunRecord {
  return {
    id: "run-1",
    revision_id: "revision-1",
    candidate_id: null,
    status: "succeeded",
    run_config: {
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      initial_cash: "100000",
      dataset_id: "filter-synthetic",
    },
    result: null,
    error: null,
    provenance: {
      source_hash: "hash",
      strategy_schema_version: "ruletrade.dev/strategy/v1",
      application_version: "0.1.0",
      build_commit: null,
      backend_id: "lean",
      engine_image: null,
      dataset_id: "filter-synthetic",
      dataset_version: null,
    },
    timings: {
      source_load_ms: 0,
      validation_ms: 0,
      compiler_ms: 0,
      codegen_ms: 0,
      csharp_compile_ms: 0,
      lean_execution_ms: 0,
      result_load_ms: 0,
      normalization_ms: 0,
      total_ms: 0,
    },
    created_at: "2024-12-31T00:00:00Z",
    started_at: "2024-12-31T00:00:00Z",
    completed_at: "2024-12-31T00:00:01Z",
    ...overrides,
  };
}

function evidenceFetcher(calls: Array<{ url: string; method?: string }>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    if (url.endsWith("/decision-events")) {
      return new Response(JSON.stringify({
        items: [matchingSummary, unrelatedSummary],
      }), { status: 200 });
    }
    if (url.endsWith("/event-filter")) {
      return new Response(JSON.stringify(matchingDetail), { status: 200 });
    }
    throw new Error(`Unexpected Evidence request: ${url}`);
  }) as typeof fetch;
}

describe("Evidence Harvest semantic boundary", () => {
  it("matches authoritative component provenance rather than display text", () => {
    expect(eventMatchesRule(matchingSummary, target)).toBe(true);
    expect(eventMatchesRule(unrelatedSummary, target)).toBe(false);
    expect(eventMatchesRule({
      source_components: [{
        role: "filter",
        component_id: "another_component",
        field_path: "config.threshold",
      }],
    }, target)).toBe(false);
  });

  it("respects field provenance while component-only lookup remains intentional", () => {
    expect(eventMatchesRule(matchingSummary, target)).toBe(true);
    expect(eventMatchesRule(matchingSummary, {
      componentId: "positive_return",
      fieldPath: "config.operator",
    })).toBe(false);
    expect(eventMatchesRule(matchingSummary, {
      componentId: "positive_return",
    })).toBe(true);
  });

  it("uses only existing persisted Evidence GETs and returns exact run/session/assets", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const matches = await loadRuleEvidenceMatches(
      [run()],
      "revision-1",
      target,
      evidenceFetcher(calls),
    );
    expect(matches).toEqual([expect.objectContaining({
      runId: "run-1",
      revisionId: "revision-1",
      sessionId: "2024-06-03",
      eventIds: ["event-filter"],
      assets: ["QQQ", "VGT"],
      kinds: ["filter"],
    })]);
    expect(calls).toEqual([
      {
        url: "/api/v1/backtest-runs/run-1/decision-events",
        method: undefined,
      },
      {
        url: "/api/v1/backtest-runs/run-1/decision-events/event-filter",
        method: undefined,
      },
    ]);
    expect(calls.every((call) => !call.url.includes("backtest-runs") || call.method === undefined))
      .toBe(true);
  });

  it("excludes unrelated revisions, failed runs, and Candidate experiments", async () => {
    const fetcher = vi.fn();
    expect(await loadRuleEvidenceMatches([
      run({ revision_id: "other" }),
      run({ status: "failed" }),
      run({ candidate_id: "candidate-1" }),
    ], "revision-1", target, fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates the exact existing ResearchContext and preserves semantic identity", async () => {
    const matches = await loadRuleEvidenceMatches(
      [run()],
      "revision-1",
      target,
      evidenceFetcher([]),
    );
    expect(researchContextForMatch(matches[0], "VGT")).toEqual({
      runId: "run-1",
      sessionId: "2024-06-03",
      asset: "VGT",
    });
    expect(matchingDetail.source_components).toContainEqual({
      role: "filter",
      component_id: target.componentId,
      field_path: target.fieldPath,
    });
  });

  it("presents a clean empty state without inventing Evidence", () => {
    const markup = renderToStaticMarkup(
      <RuleEvidenceResults
        state={{ status: "loaded", matches: [] }}
        onOpen={() => undefined}
      />,
    );
    expect(markup).toContain("No saved decisions use this rule yet.");
    expect(markup).toContain("Run and save a test");
  });

  it("presents exact persisted asset destinations through the existing Research context", async () => {
    const matches = await loadRuleEvidenceMatches(
      [run()],
      "revision-1",
      target,
      evidenceFetcher([]),
    );
    const markup = renderToStaticMarkup(
      <RuleEvidenceResults
        state={{ status: "loaded", matches }}
        preferredAsset="VGT"
        onOpen={() => undefined}
      />,
    );
    expect(markup).toContain("Qualification evaluated");
    expect(markup.indexOf("Open VGT")).toBeLessThan(markup.indexOf("Open QQQ"));
    expect(markup).toContain("Jun 3, 2024");
  });
});
