import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { V2StrategyEditor } from "../components/V2StrategyEditor";
import { CreationPicker } from "../components/CreationPicker";
import { v2AuthoringApi } from "../v2AuthoringApi";
import type { CanonicalStrategyV2, DailyValueNode } from "./canonicalV2";
import { describeConditionV2, describeDailyValue } from "./v2Semantics";
import type { StrategyDetailV2 } from "../strategyApi";
import { projectProgramProductFlow, projectProgramProductStructure, SemanticProgramBuilderAdapter } from "../components/SemanticProgramBuilderAdapter";
import { V2ConditionComposer } from "../components/V2SemanticComposer";
import { adaptV1ProductOperation, adaptV2ProductOperation, type BuilderProductOperation } from "./builderProductOperations";
import { productBlockLabel } from "../components/ProductBlockyProjection";

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
    expect(markup).not.toContain("canonical-version");
  });

  it("uses the shared semantic formatter for Value and nested Condition summaries", () => {
    expect(describeDailyValue(candidateReturn)).toContain("126-observation return");
    expect(describeConditionV2(strategy.selection!.eligibility!)).toBe("ALL · 1 conditions");
    const conditionEditor = renderToStaticMarkup(<V2ConditionComposer condition={strategy.selection!.eligibility!} strategy={strategy} role="eligibility" onChange={() => undefined} />);
    expect(conditionEditor).toContain("ANY");
    expect(conditionEditor).toContain("N-of-M");
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
    expect(markup).not.toContain("builder-adapter");
    expect(markup).toContain('data-production-builder-shell="true"');
    expect(markup).toContain("Choose 2 assets");
    expect(markup).toContain("FROM");
    expect(markup).toContain("WHERE");
    expect(markup).toContain("ORDER BY");
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
    expect(projectProgramProductFlow(programStrategy).map((item) => item.label)).toEqual([
      "Portfolio", "Growth", "Choose 2 assets", "Fallback", "Rebalance",
    ]);
  });

  it("treats the valid retain bootstrap as a user-facing empty Builder", () => {
    const blank = {
      ...strategy,
      definitions: { ...strategy.definitions, groups: [], asset_axis: { ...strategy.definitions.asset_axis, domain_id: "growth_assets" } },
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
    expect(markup).toContain("Investment");
    expect(markup).toContain("Split");
    expect(markup).toContain('aria-label="Availability status"');
    expect(markup).toContain("Ready");
    expect(markup).toContain("Needs context");
    expect(markup).toContain('id="investment-description"');
    expect(markup).toContain("A capital path backed by assets.");
    expect(markup).not.toContain("production Program lowering");
    expect(markup).not.toContain("exactly one Selection");
    expect(markup).not.toContain('class="builder-messages"');

    const capability = {
      authoring_state: "empty" as const, semantic_state: "valid" as const,
      execution_state: "incomplete" as const, provider_state: "not_checked" as const,
      runtime_state: "not_checked" as const,
      product_message: "Add an investment and choose assets before testing.",
      technical_detail: "production Program lowering currently requires exactly one Selection",
      authorable: true, reference_valid: true, backend_lowerable: false,
      production_executable: false, required_symbols: [],
      reason: "Add an investment and choose assets before testing.",
    };
    const expected = {
      overview: "A portfolio ready for its first investment.",
      guided: "One investment",
      flow: "No capital route has been defined yet.",
      blocky: "Portfolio",
      rules: "No strategy logic has been added yet.",
    } as const;
    for (const [view, copy] of Object.entries(expected)) {
      const representation = renderToStaticMarkup(<SemanticProgramBuilderAdapter
        canonical={blank} dirty={false} status="saved" message="Saved"
        onHome={() => undefined} apply={() => undefined} save={() => undefined}
        undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false}
        working={() => undefined} run={() => undefined} executionCapability={capability}
        initialView={view as keyof typeof expected}
      />);
      expect(representation).toContain(copy);
      expect(representation).not.toContain("production Program lowering");
      expect(representation).not.toContain("exactly one Selection");
      expect(representation).not.toContain('class="builder-messages"');
    }
  });

  it("dispatches one stable product operation through both canonical adapters", () => {
    const assets: BuilderProductOperation = { kind: "setAssets", assets: ["QQQ", "VGT", "SOXX", "SCHG"] };
    expect(adaptV1ProductOperation(assets, { assetSetId: "growth-assets" })).toEqual([{
      kind: "update_asset_set", asset_set_id: "growth-assets", assets: assets.assets,
    }]);
    const programStrategy = { ...strategy, selection: null, program: {
      semantic_id: "program", clocks: [{ id: "daily-close", timeframe: "daily" as const, boundary: "close" as const, timezone: "UTC", completed_only: true as const }], initial_state: {}, formalizations: [],
      statements: [{ kind: "allocate" as const, semantic_id: "initial-retain-allocation", method: "equal" as const, clock_id: "daily-close", legs: [{ semantic_id: "leg", target: { semantic_id: "target", kind: "retain" as const, ref: null }, weight: null }], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null }],
    } } satisfies CanonicalStrategyV2;
    expect(adaptV2ProductOperation(programStrategy, assets, { assetSetId: "growth_assets" })[0]).toEqual({
      kind: "set_program_asset_set", asset_set_id: "growth_assets", assets: assets.assets,
    });
    const rebalance: BuilderProductOperation = { kind: "setRebalance", cadence: "monthly" };
    expect(adaptV1ProductOperation(rebalance, { scheduleComponentId: "schedule" })[0]?.kind).toBe("update_schedule");
    expect(adaptV2ProductOperation(programStrategy, rebalance, { clockId: "daily-close" })[0]).toEqual({ kind: "set_program_schedule", clock_id: "daily-close", timeframe: "monthly" });
    expect(adaptV2ProductOperation(programStrategy, { kind: "setAllocation", method: "fixed", investments: [{ id: "growth", weight: .7 }, { id: "defensive", weight: .3 }] })[0]).toEqual({ kind: "set_program_split", investments: [["growth", .7], ["defensive", .3]] });
    const selection: BuilderProductOperation = { kind: "setSelection", lookback: 126, direction: "highest", take: 2, shortage: "require_full", qualification: { lookback: 126, operator: "gt", threshold: 0 } };
    expect(adaptV2ProductOperation(programStrategy, selection, { investmentId: "growth", clockId: "daily-close" })[0]).toMatchObject({
      kind: "create_program_selection", investment_id: "growth", lookback: 126,
      count: 2, qualification_lookback: 126, qualification_operator: "gt",
    });
  });

  it("projects the same product grammar in Structure and Flow before Selection exists", () => {
    const blankInvestment = { ...strategy, selection: null, program: {
      semantic_id: "program", clocks: [{ id: "daily-close", timeframe: "monthly" as const, boundary: "close" as const, timezone: "UTC", completed_only: true as const }], initial_state: {}, formalizations: [],
      statements: [{ kind: "allocate" as const, semantic_id: "initial-retain-allocation", method: "equal" as const, clock_id: "daily-close", legs: [{ semantic_id: "leg", target: { semantic_id: "target", kind: "retain" as const, ref: null }, weight: null }], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null }],
    } } satisfies CanonicalStrategyV2;
    const structure = projectProgramProductStructure(blankInvestment);
    expect(structure.children[0]).toMatchObject({ label: "Growth", children: [{ label: "Assets" }], capital: { portfolioShare: { value: 1, source: "implicit_single_investment" } } });
    expect(structure.children[0]?.detail).toBeUndefined();
    expect(structure.children.map((item) => item.label)).toEqual(["Growth"]);
    expect(projectProgramProductFlow(blankInvestment).map((item) => item.label)).toEqual(["Portfolio", "Growth"]);
  });

  it("keeps Portfolio routing shares distinct from internal Selection allocation", () => {
    const splitStrategy = {
      ...strategy,
      selection: null,
      definitions: {
        ...strategy.definitions,
        asset_sets: [
          ...strategy.definitions.asset_sets,
          { id: "defensive-assets", assets: ["TLT", "IEF"] },
        ],
        groups: [
          strategy.definitions.groups[0]!,
          { id: "defensive", name: "Defensive", asset_set_ref: "defensive-assets", description: "" },
        ],
      },
      program: {
        semantic_id: "program", clocks: [{ id: "monthly-close", timeframe: "monthly" as const, boundary: "close" as const, timezone: "UTC", completed_only: true as const }], initial_state: {}, formalizations: [],
        statements: [
          { kind: "select" as const, semantic_id: "growth-selection", output_id: "selected-growth", clock_id: "monthly-close", selection: strategy.selection! },
          { kind: "allocate" as const, semantic_id: "growth-equal", method: "equal" as const, clock_id: "monthly-close", legs: [{ semantic_id: "growth-equal-leg", target: { semantic_id: "growth-equal-target", kind: "selection" as const, ref: "selected-growth" }, weight: null }], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null },
          { kind: "allocate" as const, semantic_id: "portfolio-split", method: "fixed" as const, clock_id: "monthly-close", legs: [
            { semantic_id: "growth-leg", target: { semantic_id: "growth-target", kind: "group" as const, ref: "growth" }, weight: .5 },
            { semantic_id: "defensive-leg", target: { semantic_id: "defensive-target", kind: "group" as const, ref: "defensive" }, weight: .5 },
          ], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null },
        ],
      },
    } satisfies CanonicalStrategyV2;
    const structure = projectProgramProductStructure(splitStrategy);
    const split = structure.children[0]!;
    expect(split).toMatchObject({ label: "Split", detail: "50% / 50%" });
    expect(split.children.map((item) => [item.label, item.detail, item.capital?.portfolioShare])).toEqual([
      ["Growth", "50% of Portfolio", { value: .5, source: "v2_fixed_group_leg" }],
      ["Defensive", "50% of Portfolio", { value: .5, source: "v2_fixed_group_leg" }],
    ]);
    expect(split.children[0]?.capital?.selectedAssetAllocation).toEqual({ method: "equal", normalizedTotal: 1, sourceSemanticId: "growth-equal" });
    expect(split.children[1]?.capital?.selectedAssetAllocation).toBeUndefined();
    expect(projectProgramProductFlow(splitStrategy).filter((item) => item.role === "capital").map((item) => item.detail)).toContain("50% of Portfolio");
    expect(productBlockLabel(split.children[0]!)).toBe("Growth · 50% of Portfolio");

    for (const initialView of ["overview", "flow", "rules"] as const) {
      const markup = renderToStaticMarkup(<SemanticProgramBuilderAdapter canonical={splitStrategy} dirty={false} status="saved" message="Saved" onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null} initialView={initialView} />);
      expect(markup).toContain("50%");
      expect(markup).not.toContain("Growth<!-- --> · <!-- -->100%");
      expect(markup).not.toContain("Defensive<!-- --> · <!-- -->100%");
    }
    const allocationToolbox = renderToStaticMarkup(<SemanticProgramBuilderAdapter canonical={splitStrategy} dirty={false} status="saved" message="Saved" onHome={() => undefined} apply={() => undefined} save={() => undefined} undo={() => undefined} redo={() => undefined} canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null} initialView="blocky" />);
    expect(allocationToolbox).toContain("Selected assets are weighted equally within their Investment.");
    expect(allocationToolbox).not.toContain("Equal allocation is configured.");
  });
});
