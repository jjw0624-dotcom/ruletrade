import { describe, expect, it } from "vitest";

import { adaptV2ProductOperation } from "./builderProductOperations";
import type { CanonicalStrategyV2, ProgramStatementV2 } from "./canonicalV2";
import { projectV2ProductSemantics } from "./productSemantics";
import { projectProgramBlocky, projectProgramCapitalFlow, projectProgramRules } from "./programProjections";
import { emptyProgramWorkingDraft, withProgramDraftConcept } from "./programWorkingDraft";

const close = {
  semantic_id: "candidate-close", kind: "observe" as const, operands: [],
  subject_kind: "candidate" as const, subject_id: null, binding_id: "candidate",
  field: "close" as const, basis: "adjusted" as const, skip: 0,
  missing_policy: "require_all" as const, minimum_count: 1, minimum_fraction: 1,
};

const blank: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Separated grammar", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "initial-assets", assets: [] }], groups: [],
    asset_axis: { name: "asset", domain_id: "initial-assets", coordinate_policy: "member_identity" },
  },
  operator_lock: { compare: "1", "daily.trailing_return": "1" },
  selection: null, predicate: null,
  program: {
    semantic_id: "program",
    clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "UTC", completed_only: true }],
    initial_state: {}, formalizations: [],
    statements: [{
      kind: "allocate", semantic_id: "initial-retain-allocation", method: "equal", clock_id: "daily-close",
      legs: [{ semantic_id: "initial-retain-leg", target: { semantic_id: "initial-retain-target", kind: "retain", ref: null }, weight: null }],
      minimum_weight: null, maximum_weight: null, cash_remainder_asset: null,
    }],
  },
};

const choose: ProgramStatementV2 = {
  kind: "select", semantic_id: "choose-growth", output_id: "leaders", clock_id: "daily-close",
  selection: {
    semantic_id: "choose-growth-definition", universe_id: "growth",
    binding: { id: "candidate", domain_id: "growth" }, eligibility: null,
    ranking: {
      semantic_id: "ranking-return", kind: "trailing_return", operands: [close], observations: 126,
      skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
    },
    direction: "descending", count: 2, shortage_policy: "require_full", fallback_asset: "TLT",
  },
};

function grouped(statements: ProgramStatementV2[] = []): CanonicalStrategyV2 {
  return {
    ...blank,
    definitions: {
      asset_sets: [{ id: "growth-assets", assets: ["QQQ", "VGT", "SOXX", "SCHG"] }],
      groups: [{ id: "growth", name: "Growth candidates", asset_set_ref: "growth-assets", description: "" }],
      asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" },
    },
    program: { ...blank.program!, statements: [blank.program!.statements[0]!, ...statements] },
  };
}

describe("Group / Subgroup / Investment authoring grammar", () => {
  it("adapts each product action to one distinct typed semantic operation", () => {
    expect(adaptV2ProductOperation(blank, { kind: "addGroup", groupId: "growth", name: "Growth", assetSetId: "growth-assets", assets: ["QQQ"] }, {})).toEqual([expect.objectContaining({ kind: "add_program_group" })]);
    expect(adaptV2ProductOperation(grouped(), { kind: "createChoose", semanticId: "choose-growth", groupId: "growth", outputId: "leaders", lookback: 126, direction: "highest", take: 2, shortage: "require_full" }, {})).toEqual([expect.objectContaining({ kind: "create_program_choose", group_id: "growth", output_id: "leaders" })]);
    expect(adaptV2ProductOperation(grouped([choose]), { kind: "setInvestment", semanticId: "growth-investment", targetKind: "selection", targetRef: "leaders", internalAllocation: "equal" }, {})).toEqual([expect.objectContaining({ kind: "set_program_investment", target_kind: "selection", target_ref: "leaders" })]);
  });

  it("shows Group and Subgroup without inventing a capital route", () => {
    const strategy = grouped([choose]);
    const structure = projectV2ProductSemantics(strategy).root;
    expect(structure.children[0]).toMatchObject({ concept: "group", label: "Group · Growth candidates" });
    expect(structure.children[0]?.children.map((item) => item.concept)).toEqual(["assets", "subgroup"]);
    expect(projectProgramCapitalFlow(strategy)).toEqual({
      nodes: [expect.objectContaining({ id: "portfolio" })], edges: [],
    });
    expect(projectProgramBlocky(strategy).map((item) => item.role)).toEqual(expect.arrayContaining(["group", "selection"]));
    expect(projectProgramBlocky(strategy).map((item) => item.role)).not.toContain("investment");
  });

  it("adds Investment to Structure, Blocky, Flow, and Rules only when capital is connected", () => {
    const investment: ProgramStatementV2 = {
      kind: "allocate", semantic_id: "growth-investment", method: "equal", clock_id: "daily-close",
      legs: [{ semantic_id: "growth-investment-leg", target: { semantic_id: "growth-investment-target", kind: "selection", ref: "leaders" }, weight: null }],
      minimum_weight: null, maximum_weight: null, cash_remainder_asset: null,
    };
    const strategy = grouped([choose, investment]);
    expect(projectV2ProductSemantics(strategy).root.children.map((item) => item.concept)).toEqual(["group", "investment", "rebalance"]);
    expect(projectProgramBlocky(strategy).map((item) => item.role)).toContain("investment");
    expect(projectProgramCapitalFlow(strategy).nodes.map((item) => item.label)).toEqual(expect.arrayContaining(["Portfolio", "Investment · Leaders", "Choose · Leaders", "TLT", "Rebalance"]));
    expect(projectProgramRules(strategy).map((item) => item.text).join(" ")).toContain("Subgroup leaders");
    expect(projectProgramRules(strategy).map((item) => item.text).join(" ")).toContain("Investment targets leaders");
  });

  it("preserves incomplete alternate-order drafts outside Canonical", () => {
    const source = emptyProgramWorkingDraft("strategy");
    const logicFirst = withProgramDraftConcept(source, { kind: "choose", semanticId: "choose-1", groupId: null, outputId: "leaders", lookback: 126, direction: "highest", count: 2, shortage: "require_full" });
    const investmentFirst = withProgramDraftConcept(source, { kind: "investment", semanticId: "investment-1", targetKind: null, targetRef: null, internalAllocation: "equal" });
    expect(logicFirst).toMatchObject({ status: "incomplete", concept: { kind: "choose", groupId: null } });
    expect(investmentFirst).toMatchObject({ status: "incomplete", concept: { kind: "investment", targetRef: null } });
    expect(blank.definitions.groups).toEqual([]);
    expect(blank.program?.statements).toHaveLength(1);
  });
});
