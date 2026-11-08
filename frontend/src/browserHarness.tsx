import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "./domain/canonicalV2";
import { emptyProgramWorkingDraft, type ProgramWorkingDraft } from "./domain/programWorkingDraft";
import { SemanticProgramBuilderAdapter } from "./components/SemanticProgramBuilderAdapter";
import { V2StrategyEditor } from "./components/V2StrategyEditor";
import { ResultWorkspace } from "./components/ResultWorkspace";
import type { StrategyDetailV2 } from "./strategyApi";
import type { BacktestRunRecord } from "./backtestRunApi";
import equivalenceFixture from "../../corpus/ui-authored-execution-equivalence.json";
import advancedEquivalenceFixture from "../../corpus/advanced-ui-authored-execution-equivalence.json";

const browserParams = new URLSearchParams(window.location.search);
const journey = browserParams.get("journey");
const advancedCaseId = browserParams.get("case");
const advancedCase = advancedEquivalenceFixture.cases.find((item) => item.id === advancedCaseId) ?? null;
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, child) => {
  if (!child || typeof child !== "object" || Array.isArray(child)) return child;
  return Object.fromEntries(Object.entries(child as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
});

const assets = [
  ["QQQ", "Invesco QQQ Trust", "ETF"], ["VGT", "Vanguard Information Technology ETF", "ETF"],
  ["SOXX", "iShares Semiconductor ETF", "ETF"], ["SCHG", "Schwab U.S. Large-Cap Growth ETF", "ETF"],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "ETF"], ["AAPL", "Apple Inc.", "Equity"],
] as const;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  const browserWindow = window as typeof window & { __RULETRADE_BROWSER_REQUESTS__?: Array<{ url: string; method: string }> };
  browserWindow.__RULETRADE_BROWSER_REQUESTS__ = [...(browserWindow.__RULETRADE_BROWSER_REQUESTS__ ?? []), { url, method: init?.method ?? "GET" }];
  if (url === "/api/v2/canonical/authoring/apply") {
    const request = JSON.parse(String(init?.body ?? "{}")) as { operation?: V2AuthoringOperation };
    if (journey === "ui-authored-advanced" && advancedCase) {
      if (stableJson(request.operation) !== stableJson(advancedCase.operation)) return new Response(JSON.stringify({ detail: { code: "unexpected_operation", message: `The ${advancedCase.id} browser gesture produced a different operation.` } }), { status: 422, headers: { "content-type": "application/json" } });
      const state = window as typeof window & { __RULETRADE_ADVANCED_EQUIVALENCE__?: Record<string, unknown> };
      state.__RULETRADE_ADVANCED_EQUIVALENCE__ = { ...(state.__RULETRADE_ADVANCED_EQUIVALENCE__ ?? {}), caseId: advancedCase.id, operation: request.operation, appliedCanonical: advancedCase.expected_canonical };
      return new Response(JSON.stringify({ strategy: advancedCase.expected_canonical, source_hash: `sha256:${advancedCase.id}` }), { headers: { "content-type": "application/json" } });
    }
    if (JSON.stringify(request.operation) !== JSON.stringify(uiEquivalenceCase.operation)) return new Response(JSON.stringify({ detail: { code: "unexpected_operation", message: "The browser gesture produced a different operation." } }), { status: 422, headers: { "content-type": "application/json" } });
    const state = window as typeof window & { __RULETRADE_UI_EQUIVALENCE__?: Record<string, unknown> };
    state.__RULETRADE_UI_EQUIVALENCE__ = { ...(state.__RULETRADE_UI_EQUIVALENCE__ ?? {}), operation: request.operation, appliedCanonical: uiExpectedCanonical };
    return new Response(JSON.stringify({ strategy: uiExpectedCanonical, source_hash: "sha256:ui-authored" }), { headers: { "content-type": "application/json" } });
  }
  if (url === "/api/v1/strategies/strategy-ui-authored/revisions" && init?.method === "POST") {
    const request = JSON.parse(String(init.body ?? "{}")) as { canonical_strategy?: CanonicalStrategyV2 };
    if (JSON.stringify(request.canonical_strategy) !== JSON.stringify(uiExpectedCanonical)) return new Response(JSON.stringify({ detail: { code: "canonical_mismatch", message: "Saved Canonical differs from the UI equivalence fixture." } }), { status: 422, headers: { "content-type": "application/json" } });
    uiSavedDetail = uiPersistedDetail("revision-ui-authored-2", uiExpectedCanonical, "sha256:ui-authored");
    const state = window as typeof window & { __RULETRADE_UI_EQUIVALENCE__?: Record<string, unknown> };
    state.__RULETRADE_UI_EQUIVALENCE__ = { ...(state.__RULETRADE_UI_EQUIVALENCE__ ?? {}), savedCanonical: request.canonical_strategy, savedRevision: "revision-ui-authored-2" };
    return new Response(JSON.stringify({ created: true, strategy: uiSavedDetail.strategy, revision: uiSavedDetail.current_revision }), { status: 201, headers: { "content-type": "application/json" } });
  }
  if (advancedCase && url === `/api/v1/strategies/strategy-advanced-${advancedCase.id}/revisions` && init?.method === "POST") {
    const request = JSON.parse(String(init.body ?? "{}")) as { canonical_strategy?: CanonicalStrategyV2 };
    if (stableJson(request.canonical_strategy) !== stableJson(advancedCase.expected_canonical)) return new Response(JSON.stringify({ detail: { code: "canonical_mismatch", message: `Saved ${advancedCase.id} Canonical differs from the backend fixture.` } }), { status: 422, headers: { "content-type": "application/json" } });
    advancedSavedDetail = advancedPersistedDetail(advancedCase.id, "revision-advanced-2", advancedCase.expected_canonical as unknown as CanonicalStrategyV2, `sha256:${advancedCase.id}`);
    const state = window as typeof window & { __RULETRADE_ADVANCED_EQUIVALENCE__?: Record<string, unknown> };
    state.__RULETRADE_ADVANCED_EQUIVALENCE__ = { ...(state.__RULETRADE_ADVANCED_EQUIVALENCE__ ?? {}), savedCanonical: request.canonical_strategy, savedRevision: "revision-advanced-2" };
    return new Response(JSON.stringify({ created: true, strategy: advancedSavedDetail.strategy, revision: advancedSavedDetail.current_revision }), { status: 201, headers: { "content-type": "application/json" } });
  }
  if (url === `/api/v2/revisions/${uiAuthoredRun.revision_id}/backtest-runs`) return new Response(JSON.stringify(init?.method === "POST" ? uiAuthoredRun : { items: [] }), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
  if (advancedCase && url === "/api/v2/revisions/revision-advanced-2/backtest-runs") return new Response(JSON.stringify(init?.method === "POST" ? advancedRun(advancedCase.id) : { items: [] }), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/v2/canonical/strategies/execution-capability")) return new Response(JSON.stringify({ authoring_state: "committed", semantic_state: "valid", execution_state: "executable", provider_state: "available", runtime_state: "available", product_message: "Ready to test.", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: true, production_executable: true, reason: null }), { headers: { "content-type": "application/json" } });
  if (url === `/api/v2/revisions/${persistedRun.revision_id}/backtest-runs`) return new Response(JSON.stringify(init?.method === "POST" ? persistedRun : { items: [persistedRun] }), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
  if (url === `/api/v2/backtest-runs/${persistedRun.id}/decision-events`) return new Response(JSON.stringify({ items: [evidenceSummary] }), { headers: { "content-type": "application/json" } });
  if (url === `/api/v2/backtest-runs/${persistedRun.id}/decision-events/${evidenceSummary.id}`) return new Response(JSON.stringify({ ...evidenceSummary, evidence: { kind: "final_targets", selected: ["QQQ"], targets: { QQQ: "1" } } }), { headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/v1/assets/compare")) return new Response(JSON.stringify({ as_of: "2026-10-24", items: [] }), { headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/v1/assets/")) {
    const symbol = decodeURIComponent(url.split("/api/v1/assets/")[1]!.split("?")[0]!);
    const row = assets.find((item) => item[0] === symbol) ?? assets[0];
    const series = Array.from({ length: 40 }, (_, index) => { const day = new Date(Date.UTC(2026, 8, 1 + index)); return { date: day.toISOString().slice(0, 10), adjusted_close: String(100 + index) }; });
    return new Response(JSON.stringify({ asset: { symbol: row[0], name: row[1], asset_type: row[2], data_status: "available", available_from: "2025-01-01", available_to: "2026-10-24" }, as_of: "2026-10-24", mode: "current", series, metrics: [{ id: "price", label: "Adjusted close", status: "available", value: "139", value_type: "money.usd" }, { id: "return", label: "126-observation return", status: "insufficient_history", reason: "Harness history is intentionally bounded." }], memberships: [], capabilities: [] }), { headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("/api/v1/assets")) return new Response(JSON.stringify({ items: assets.map(([symbol, name, asset_type]) => ({ symbol, name, asset_type, data_status: "available", available_from: "2025-01-01", available_to: "2026-10-24" })) }), { headers: { "content-type": "application/json" } });
  return originalFetch(input, init);
};

const blank: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2", semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Browser Acceptance", description: "", tags: [] },
  definitions: { asset_sets: [{ id: "initial-assets", assets: [] }], groups: [], asset_axis: { name: "asset", domain_id: "initial-assets", coordinate_policy: "member_identity" } },
  operator_lock: {}, selection: null, predicate: null,
  program: { semantic_id: "program", clocks: [], initial_state: {}, formalizations: [], statements: [] },
};

const uiEquivalenceCase = equivalenceFixture.case;
const uiExpectedCanonical = uiEquivalenceCase.expected_canonical as CanonicalStrategyV2;
const uiAuthoringBlank: CanonicalStrategyV2 = {
  ...blank,
  metadata: { name: "UI Authored Monthly QQQ", description: "", tags: [] },
  operator_lock: { compare: "1" },
  program: {
    semantic_id: "program",
    clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "UTC", completed_only: true, terminal_boundary_policy: "not_due" }],
    initial_state: {}, formalizations: [],
    statements: [{ kind: "allocate", semantic_id: "initial-retain-allocation", method: "equal", clock_id: "daily-close", legs: [{ semantic_id: "initial-retain-leg", target: { semantic_id: "initial-retain-target", kind: "retain", ref: null }, weight: null }], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null }],
  },
};

function uiPersistedDetail(revisionId: string, canonical: CanonicalStrategyV2, sourceHash: string): StrategyDetailV2 {
  return {
    strategy: { id: "strategy-ui-authored", name: canonical.metadata.name, created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z", current_revision_id: revisionId, archived_at: null },
    current_revision: { id: revisionId, strategy_id: "strategy-ui-authored", parent_revision_id: revisionId === "revision-ui-authored-1" ? null : "revision-ui-authored-1", canonical_strategy: canonical, source_hash: sourceHash, schema_version: canonical.api_version, created_at: "2026-11-05T00:00:00Z" },
  };
}

const uiInitialDetail = uiPersistedDetail("revision-ui-authored-1", uiAuthoringBlank, "sha256:ui-blank");
let uiSavedDetail: StrategyDetailV2 | null = null;

function advancedPersistedDetail(caseId: string, revisionId: string, canonical: CanonicalStrategyV2, sourceHash: string): StrategyDetailV2 {
  return {
    strategy: { id: `strategy-advanced-${caseId}`, name: canonical.metadata.name, created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z", current_revision_id: revisionId, archived_at: null },
    current_revision: { id: revisionId, strategy_id: `strategy-advanced-${caseId}`, parent_revision_id: revisionId === "revision-advanced-1" ? null : "revision-advanced-1", canonical_strategy: canonical, source_hash: sourceHash, schema_version: canonical.api_version, created_at: "2026-11-05T00:00:00Z" },
  };
}

const advancedAuthoringBlank: CanonicalStrategyV2 = {
  ...blank,
  metadata: { name: "Advanced UI Authored", description: "", tags: [] },
};
const advancedInitialDetail = (caseId: string) => advancedPersistedDetail(caseId, "revision-advanced-1", advancedAuthoringBlank, "sha256:advanced-blank");
let advancedSavedDetail: StrategyDetailV2 | null = null;

const persistedCanonical: CanonicalStrategyV2 = {
  ...blank,
  metadata: { ...blank.metadata, name: "Persisted V2 Journey" },
  definitions: {
    ...blank.definitions,
    asset_sets: [{ id: "growth-assets", assets: ["QQQ"] }],
    groups: [{ id: "growth", name: "Growth", asset_set_ref: "growth-assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" },
  },
  program: {
    semantic_id: "program", initial_state: {}, formalizations: [],
    clocks: [{ id: "monthly-close", timeframe: "monthly", boundary: "close", timezone: "UTC", completed_only: true }],
    statements: [{ kind: "allocate", semantic_id: "growth-allocation", method: "fixed", clock_id: "monthly-close", legs: [{ semantic_id: "growth-leg", target: { semantic_id: "growth-target", kind: "asset", ref: "QQQ" }, weight: 1 }], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null }],
  },
};

const persistedDetail: StrategyDetailV2 = {
  strategy: { id: "strategy-v2-browser", name: "Persisted V2 Journey", created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z", current_revision_id: "revision-v2-browser", archived_at: null },
  current_revision: { id: "revision-v2-browser", strategy_id: "strategy-v2-browser", parent_revision_id: null, canonical_strategy: persistedCanonical, source_hash: "sha256:browser-v2", schema_version: persistedCanonical.api_version, created_at: "2026-11-02T00:00:00Z" },
};

const persistedRun: BacktestRunRecord = {
  id: "run-v2-browser", revision_id: "revision-v2-browser", status: "succeeded", run_config: { start_date: "2024-01-01", end_date: "2024-02-29", initial_cash: "100000", dataset_id: "filter-synthetic" },
  result: { initial_value: "100000", final_value: "110000", total_return: "0.1", total_orders: 1, total_fees: "1", equity_curve: [{ timestamp: "2024-01-01T00:00:00Z", value: "100000" }, { timestamp: "2024-02-29T00:00:00Z", value: "110000" }] }, error: null,
  provenance: { source_hash: "sha256:browser-v2", strategy_schema_version: persistedCanonical.api_version, application_version: "browser", build_commit: "browser-head", backend_id: "lean", engine_image: "lean:browser", dataset_id: "filter-synthetic", dataset_version: "browser-v1" },
  timings: { source_load_ms: 1, validation_ms: 1, compiler_ms: 1, codegen_ms: 1, csharp_compile_ms: 1, lean_execution_ms: 1, result_load_ms: 1, normalization_ms: 1, total_ms: 8 }, created_at: "2026-11-02T00:00:00Z", started_at: "2026-11-02T00:00:01Z", completed_at: "2026-11-02T00:00:08Z",
};

const uiAuthoredRun: BacktestRunRecord = {
  ...persistedRun,
  id: "run-ui-authored",
  revision_id: "revision-ui-authored-2",
  provenance: { ...persistedRun.provenance, source_hash: "sha256:ui-authored" },
};

const advancedRun = (caseId: string): BacktestRunRecord => ({
  ...persistedRun,
  id: `run-advanced-${caseId}`,
  revision_id: "revision-advanced-2",
  provenance: { ...persistedRun.provenance, source_hash: `sha256:${caseId}` },
});

const evidenceSummary = { id: "decision-v2-browser", run_id: persistedRun.id, ordinal: 1, schema_version: 2 as const, session_id: "2024-02-29", phase: "portfolio_execution", kind: "final_targets", source_components: [{ role: "rebalance", component_id: "growth-allocation" }] };

function Harness() {
  const [canonical, setCanonical] = useState<CanonicalStrategyV2>(blank);
  const [draft, setDraft] = useState<ProgramWorkingDraft>(() => emptyProgramWorkingDraft("browser-acceptance"));
  const apply = (operation: V2AuthoringOperation) => {
    if (operation.kind !== "add_program_group") return;
    setCanonical((current) => ({
      ...current,
      definitions: {
        ...current.definitions,
        asset_sets: [...current.definitions.asset_sets.filter((item) => item.id !== operation.asset_set_id), { id: operation.asset_set_id, assets: operation.assets }],
        groups: [...current.definitions.groups.filter((item) => item.id !== operation.group_id), { id: operation.group_id, name: operation.name, asset_set_ref: operation.asset_set_id, description: "" }],
      },
    }));
  };
  return <SemanticProgramBuilderAdapter canonical={canonical} dirty={false} status="saved" message="Saved" initialView="blocky"
    onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
    canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
    workingDraft={draft} onWorkingDraftChange={(next) => { (window as typeof window & { __RULETRADE_BROWSER_DRAFT__?: ProgramWorkingDraft }).__RULETRADE_BROWSER_DRAFT__ = next; setDraft(next); }} />;
}

const blockyGroupHandoffCanonical: CanonicalStrategyV2 = {
  ...blank,
  metadata: { ...blank.metadata, name: "Blocky Group Handoff" },
  definitions: {
    asset_sets: [{ id: "group-1-assets", assets: ["QQQ", "VOO"] }],
    groups: [{ id: "group-1", name: "Group 1", asset_set_ref: "group-1-assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "group-1-assets", coordinate_policy: "member_identity" },
  },
  program: {
    semantic_id: "program",
    clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "UTC", completed_only: true }],
    initial_state: {},
    formalizations: [],
    statements: [],
  },
};

function BlockyGroupHandoffHarness() {
  const [canonical, setCanonical] = useState(blockyGroupHandoffCanonical);
  const [draft, setDraft] = useState<ProgramWorkingDraft>(() => ({
    ...emptyProgramWorkingDraft("blocky-group-handoff"),
    canvasBlocks: {
      "draft:start": { id: "draft:start", definitionId: "start-daily", label: "Every daily close", active: false, createdAt: "2026-11-08T00:00:00Z" },
      "draft:rebalance": { id: "draft:rebalance", definitionId: "rebalance", label: "Rebalance", active: false, createdAt: "2026-11-08T00:00:00Z" },
      "draft:group": { id: "draft:group", definitionId: "group-reference", label: "Group 1", active: false, objectRef: "group-1", createdAt: "2026-11-08T00:00:00Z" },
      "draft:weight": { id: "draft:weight", definitionId: "percentage", label: "100%", active: false, fieldValues: { VALUE: 100 }, createdAt: "2026-11-08T00:00:00Z" },
    },
    blockConnections: {
      "draft:start": { childId: "draft:start", parentId: null, inputName: null },
      "draft:rebalance": { childId: "draft:rebalance", parentId: "draft:start", inputName: "NEXT" },
      "draft:group": { childId: "draft:group", parentId: "draft:rebalance", inputName: "TARGET" },
      "draft:weight": { childId: "draft:weight", parentId: "draft:rebalance", inputName: "WEIGHT" },
    },
    blockPositions: {
      "draft:start": { x: 320, y: 160 },
      "draft:rebalance": { x: 320, y: 250 },
      "draft:group": { x: 560, y: 250 },
      "draft:weight": { x: 700, y: 250 },
    },
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: "rt_entry_start_daily",
          id: "native-start",
          x: 320,
          y: 160,
          data: JSON.stringify({ productId: "draft:start", definitionId: "start-daily" }),
          inputs: {
            NEXT: {
              block: {
                type: "rt_entry_rebalance",
                id: "native-rebalance",
                data: JSON.stringify({ productId: "draft:rebalance", definitionId: "rebalance" }),
                inputs: {
                  TARGET: {
                    block: {
                      type: "rt_entry_group_reference",
                      id: "native-group",
                      fields: { REFERENCE: "group-1" },
                      data: JSON.stringify({ productId: "draft:group", definitionId: "group-reference", objectRef: "group-1" }),
                    },
                  },
                  WEIGHT: {
                    block: {
                      type: "rt_entry_percentage",
                      id: "native-weight",
                      fields: { VALUE: 100 },
                      data: JSON.stringify({ productId: "draft:weight", definitionId: "percentage" }),
                    },
                  },
                },
              },
            },
          },
        }],
      },
    },
  }));
  (window as typeof window & { __RULETRADE_BROWSER_DRAFT__?: ProgramWorkingDraft }).__RULETRADE_BROWSER_DRAFT__ = draft;
  (window as typeof window & { __RULETRADE_BROWSER_CANONICAL__?: CanonicalStrategyV2 }).__RULETRADE_BROWSER_CANONICAL__ = canonical;
  const prepareTest = (operation: V2AuthoringOperation | null) => {
    (window as typeof window & { __RULETRADE_BLOCKY_GROUP_HANDOFF__?: { operation: V2AuthoringOperation | null } }).__RULETRADE_BLOCKY_GROUP_HANDOFF__ = { operation };
    if (operation?.kind !== "set_program_investment") return;
    setCanonical((current) => ({
      ...current,
      program: current.program ? {
        ...current.program,
        statements: [{
          kind: "allocate",
          semantic_id: operation.semantic_id,
          method: operation.internal_allocation,
          clock_id: operation.clock_id,
          legs: [{ semantic_id: `${operation.semantic_id}-leg`, target: { semantic_id: `${operation.semantic_id}-target`, kind: operation.target_kind, ref: operation.target_ref }, weight: null }],
          minimum_weight: null,
          maximum_weight: null,
          cash_remainder_asset: null,
        }],
      } : null,
    }));
  };
  return <SemanticProgramBuilderAdapter canonical={canonical} dirty={false} status="saved" message="Saved" initialView="blocky"
    onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined}
    canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} prepareTest={prepareTest} executionCapability={null}
    workingDraft={draft} onWorkingDraftChange={(next) => setDraft(next)} />;
}

const flowRemovalCanonical: CanonicalStrategyV2 = {
  ...blank,
  metadata: { ...blank.metadata, name: "Flow Removal" },
  definitions: {
    ...blank.definitions,
    asset_sets: [{ id: "growth-assets", assets: ["QQQ"] }, { id: "defense-assets", assets: ["TLT"] }],
    groups: [{ id: "growth", name: "Growth", asset_set_ref: "growth-assets", description: "" }, { id: "defense", name: "Defensive", asset_set_ref: "defense-assets", description: "" }],
  },
  program: { semantic_id: "program", initial_state: {}, formalizations: [], clocks: [{ id: "monthly-close", timeframe: "monthly", boundary: "close", timezone: "UTC", completed_only: true }], statements: [{
    kind: "allocate", semantic_id: "browser-split", method: "fixed", clock_id: "monthly-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null,
    legs: [{ semantic_id: "growth-leg", target: { semantic_id: "growth-target", kind: "group", ref: "growth" }, weight: .7 }, { semantic_id: "defense-leg", target: { semantic_id: "defense-target", kind: "group", ref: "defense" }, weight: .3 }],
  }] },
};

function FlowRemovalHarness() {
  const [canonical, setCanonical] = useState(flowRemovalCanonical);
  const [draft, setDraft] = useState(() => emptyProgramWorkingDraft("browser-flow-removal"));
  (window as typeof window & { __RULETRADE_BROWSER_CANONICAL__?: CanonicalStrategyV2 }).__RULETRADE_BROWSER_CANONICAL__ = canonical;
  const apply = (operation: V2AuthoringOperation) => {
    if (operation.kind === "remove_program_investment_allocation") setCanonical((current) => ({ ...current, program: current.program ? { ...current.program, statements: current.program.statements.filter((statement) => statement.semantic_id !== operation.semantic_id) } : null }));
  };
  return <SemanticProgramBuilderAdapter canonical={canonical} dirty={false} status="saved" message="Saved" initialView="flow"
    onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
    canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
    workingDraft={draft} onWorkingDraftChange={(next) => { (window as typeof window & { __RULETRADE_BROWSER_DRAFT__?: ProgramWorkingDraft }).__RULETRADE_BROWSER_DRAFT__ = next; setDraft(next); }} />;
}

function PersistedJourneyHarness() {
  const [run, setRun] = useState<BacktestRunRecord | null>(null);
  if (run) return <ResultWorkspace run={run} strategyName="Persisted V2 Journey" onBack={() => setRun(null)} />;
  return <V2StrategyEditor persisted={persistedDetail} onHome={() => undefined} onOpenRun={() => setRun(persistedRun)} />;
}

function UiAuthoredEquivalenceHarness() {
  const [open, setOpen] = useState(true);
  const [generation, setGeneration] = useState(0);
  if (!open) return <main aria-label="Strategy home"><h1>Strategies</h1><button type="button" onClick={() => { setGeneration((value) => value + 1); setOpen(true); }}>Reopen saved strategy</button></main>;
  return <V2StrategyEditor key={`${uiSavedDetail?.current_revision.id ?? "initial"}-${generation}`} persisted={uiSavedDetail ?? uiInitialDetail} onHome={() => setOpen(false)} />;
}

function AdvancedUiAuthoredEquivalenceHarness({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(true);
  const [generation, setGeneration] = useState(0);
  if (!open) return <main aria-label="Strategy home"><h1>Strategies</h1><button type="button" onClick={() => { setGeneration((value) => value + 1); setOpen(true); }}>Reopen saved strategy</button></main>;
  return <V2StrategyEditor key={`${advancedSavedDetail?.current_revision.id ?? "initial"}-${generation}`} persisted={advancedSavedDetail ?? advancedInitialDetail(caseId)} onHome={() => setOpen(false)} />;
}

createRoot(document.getElementById("root")!).render(journey === "ui-authored-advanced" && advancedCase ? <AdvancedUiAuthoredEquivalenceHarness caseId={advancedCase.id} /> : journey === "ui-authored-equivalence" ? <UiAuthoredEquivalenceHarness /> : journey === "persisted-v2" ? <PersistedJourneyHarness /> : journey === "flow-removal" ? <FlowRemovalHarness /> : journey === "blocky-group-handoff" ? <BlockyGroupHandoffHarness /> : <Harness />);
