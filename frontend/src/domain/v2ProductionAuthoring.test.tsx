import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { V2StrategyEditor } from "../components/V2StrategyEditor";
import { CreationPicker } from "../components/CreationPicker";
import { v2AuthoringApi } from "../v2AuthoringApi";
import type { CanonicalStrategyV2, DailyValueNode } from "./canonicalV2";
import { describeConditionV2, describeDailyValue } from "./v2Semantics";
import type { StrategyDetailV2 } from "../strategyApi";
import { projectProgramProductStructure } from "../components/SemanticProgramBuilderAdapter";

const close: DailyValueNode = {
  semantic_id: "candidate-close", kind: "observe", operands: [],
  subject_kind: "candidate", binding_id: "candidate", subject_id: null,
  field: "close", basis: "adjusted", skip: 0,
  missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
};

const candidateReturn: DailyValueNode = {
  semantic_id: "candidate-return", kind: "trailing_return", operands: [close],
  observations: 126, skip: 0, missing_policy: "require_all",
  minimum_count: 1, minimum_fraction: 1,
};

const strategy: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Profile A selection", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "growth_assets", assets: ["QQQ", "VGT", "SOXX"] }],
    groups: [{ id: "growth", name: "Growth", asset_set_ref: "growth_assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" },
  },
  operator_lock: { compare: "1", "daily.trailing_return": "1" },
  selection: {
    semantic_id: "selection",
    universe_id: "growth",
    binding: { id: "candidate", domain_id: "growth" },
    eligibility: {
      kind: "all", semantic_id: "all", children: [{
        kind: "comparison", semantic_id: "positive", operator: "gt",
        left: candidateReturn,
        right: {
          semantic_id: "zero", kind: "literal", operands: [], quantity: "return",
          unit: "ratio", refinement: "trailing_return:adjusted_close", value: 0,
          skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
        },
      }],
    },
    ranking: candidateReturn,
    direction: "descending",
    count: 2,
    shortage_policy: "require_full",
    fallback_asset: "TLT",
  },
  predicate: null,
};

const detail: StrategyDetailV2 = {
  strategy: {
    id: "strategy-v2", name: "Profile A selection",
    created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
    current_revision_id: "revision-v2", archived_at: null,
  },
  current_revision: {
    id: "revision-v2", strategy_id: "strategy-v2", parent_revision_id: null,
    canonical_strategy: strategy, source_hash: "sha256:v2",
    schema_version: "ruletrade.dev/strategy/v2", created_at: "2026-10-07T00:00:00Z",
  },
};

describe("mounted v2 production editor", () => {
  it("offers a normal blank Strategy path without exposing Program internals", () => {
    const markup = renderToStaticMarkup(<CreationPicker onChoose={() => undefined} onProgram={() => undefined} onClose={() => undefined} />);
    expect(markup).toContain("Blank strategy");
    expect(markup).toContain("Start in the Builder");
    expect(markup).not.toContain("Blank Program");
    expect(markup).not.toContain("typed Values, Conditions, Events, State, Selection, and Allocation");
  });

  it("requests a backend-authoritative Program template instead of synthesizing Selection", async () => {
    let body = "";
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ ...strategy, selection: null, program: { semantic_id: "program", clocks: [], initial_state: {}, statements: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const created = await v2AuthoringApi.programTemplate("New Program", ["SPY", "TLT"], fetcher);
    expect(JSON.parse(body)).toEqual({ name: "New Program", assets: ["SPY", "TLT"] });
    expect(created.selection).toBeNull();
    expect(created.program?.semantic_id).toBe("program");
  });
  it("renders one coherent semantic Selection inspector without schema-form actions", () => {
    const markup = renderToStaticMarkup(<V2StrategyEditor persisted={detail} onHome={() => undefined} />);
    for (const label of ["FROM", "WHERE", "ORDER BY", "DIRECTION", "TAKE", "WHEN FEWER QUALIFY", "SELECTION FALLBACK"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("QQQ · VGT · SOXX");
    expect(markup).toContain("126-observation return");
    expect(markup).toContain("TLT");
    expect(markup).not.toContain("Update condition");
    expect(markup).not.toContain("Apply condition");
    expect(markup).not.toContain("Return period");
    expect(markup).not.toContain("Scale = 1");
    expect(markup).toContain('data-canonical-version="v2"');
  });

  it("uses the shared semantic formatter for Value and nested Condition summaries", () => {
    expect(describeDailyValue(candidateReturn)).toContain("126-observation return");
    expect(describeConditionV2(strategy.selection!.eligibility!)).toBe("ALL · 1 conditions");
  });

  it("opens Program-native revisions without assuming a compatibility Selection", () => {
    const programStrategy: CanonicalStrategyV2 = {
      ...strategy,
      selection: null,
      program: {
        semantic_id: "program",
        clocks: [{
          id: "daily-close",
          timeframe: "daily",
          boundary: "close",
          timezone: "UTC",
          completed_only: true,
        }],
        initial_state: {},
        formalizations: [{ source_phrase: "positive momentum", status: "formalized", semantic_ids: ["program-selection"], interpretation: "Rank the configured candidates by 126-observation return." }],
        statements: [{
          kind: "select", semantic_id: "program-selection", output_id: "selected-growth", clock_id: "daily-close",
          selection: { ...strategy.selection!, semantic_id: "program-selection-definition" },
        }, {
          kind: "allocate", semantic_id: "allocate", method: "equal", clock_id: "daily-close",
          legs: [{ semantic_id: "retain-leg", target: { semantic_id: "retain-target", kind: "retain", ref: null }, weight: null }],
          minimum_weight: null, maximum_weight: null, cash_remainder_asset: null,
        }],
      },
    };
    const markup = renderToStaticMarkup(<V2StrategyEditor
      persisted={{
        ...detail,
        current_revision: {
          ...detail.current_revision,
          canonical_strategy: programStrategy,
        },
      }}
      onHome={() => undefined}
    />);
    expect(markup).toContain('data-builder-adapter="semantic-engine"');
    expect(markup).toContain('data-production-builder-shell="true"');
    expect(markup).toContain("Choose 2 assets");
    expect(markup).toContain("FROM");
    expect(markup).toContain("WHERE");
    expect(markup).toContain("ORDER BY");
    expect(markup).toContain("ANY");
    expect(markup).toContain("N-of-M");
    expect(markup).toContain("Action");
    expect(markup).not.toContain("Event semantics");
    expect(markup).not.toContain("State semantics");
    expect(markup).not.toContain("program-selection-definition");
    expect(markup).not.toContain("initial-retain-allocation");
    expect(markup).not.toContain("ANY and nested conditions remain unavailable");
    expect(markup).not.toContain("Generalized Program authoring is intentionally deferred");
  });

  it("projects Program semantics through the existing product structure vocabulary", () => {
    const programStrategy: CanonicalStrategyV2 = {
      ...strategy,
      selection: null,
      program: {
        semantic_id: "program",
        clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "UTC", completed_only: true }],
        initial_state: {}, formalizations: [],
        statements: [{ kind: "select", semantic_id: "program-selection", output_id: "selected", clock_id: "daily-close", selection: strategy.selection! }],
      },
    };
    const structure = projectProgramProductStructure(programStrategy);
    expect(structure.label).toBe("Portfolio");
    expect(structure.children[0]?.children.map((item) => item.label)).toEqual([
      "Assets", "Qualification", "Choose 2 assets", "Fallback",
    ]);
    expect(JSON.stringify(structure)).not.toContain("semantic_id");
  });

  it("treats the valid retain bootstrap as a user-facing empty Builder", () => {
    const blank = {
      ...strategy,
      selection: null,
      program: {
        semantic_id: "program",
        clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "UTC", completed_only: true }],
        initial_state: {},
        formalizations: [],
        statements: [{
          kind: "allocate" as const,
          semantic_id: "initial-retain-allocation",
          method: "equal" as const,
          clock_id: "daily-close",
          legs: [{ semantic_id: "initial-retain-leg", target: { semantic_id: "initial-retain-target", kind: "retain" as const, ref: null }, weight: null }],
          minimum_weight: null,
          maximum_weight: null,
          cash_remainder_asset: null,
        }],
      },
    } satisfies CanonicalStrategyV2;
    const markup = renderToStaticMarkup(<V2StrategyEditor persisted={{ ...detail, current_revision: { ...detail.current_revision, canonical_strategy: blank } }} onHome={() => undefined} />);
    expect(markup).toContain("Portfolio");
    expect(markup).toContain("Structure");
    expect(markup).toContain("Add");
    expect(markup).not.toContain("Start building your strategy");
    expect(markup).not.toContain("initial-retain-allocation");
    expect(markup).not.toContain("Allocate equally");
    expect(markup).not.toContain("Move up");
    expect(markup).not.toContain("Move down");
  });
});
