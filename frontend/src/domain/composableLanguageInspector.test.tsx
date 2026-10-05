import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConditionComposer } from "../components/ConditionComposer";
import { SelectionComposer } from "../components/SelectionComposer";
import { ValueComposer } from "../components/ValueComposer";
import type { CanonicalStrategyV1 } from "./canonical";

const strategy = {
  api_version: "ruletrade.dev/strategy/v1",
  metadata: { name: "Values", description: "", tags: [] },
  random_seed: 0,
  definitions: { asset_sets: [{ id: "assets", assets: ["SPY", "QQQ"] }], parameters: [], state: [] },
  graph: { components: [{ id: "universe", primitive: "asset_set@1", config: { asset_set_ref: "assets" } }], connections: [] },
  entrypoints: [],
} as unknown as CanonicalStrategyV1;

const candidateReturn = {
  kind: "indicator", indicator_id: "trailing_return_indicator@1",
  asset: { kind: "candidate" }, parameters: { lookback_bars: 63 },
} as const;

describe("semantic expression authoring controls", () => {
  it("renders a committed condition as one compact comparison instead of an expanded schema form", () => {
    const html = renderToStaticMarkup(<ConditionComposer role="eligibility" strategy={strategy} expression={{
      kind: "comparison", operator: "gt", left: candidateReturn,
      right: { kind: "literal", value_type: "percentage", value: 0 },
    }} onChange={vi.fn()} />);
    expect(html).toContain("Candidate&#x27;s 63-observation return &gt; 0%");
    expect(html).toContain(">Edit<");
    expect(html).not.toContain("Update condition");
    expect(html).not.toContain("Apply condition");
    expect(html).not.toContain("Scale = 1");
    expect(html).not.toContain("Left value");
    expect(html).not.toContain("Right value");
  });

  it("keeps a new condition local and unfinished until both semantic Values exist", () => {
    const change = vi.fn();
    const html = renderToStaticMarkup(<ConditionComposer role="predicate" strategy={strategy} expression={null} initiallyOpen onChange={change} />);
    expect(html).toContain("Set condition");
    expect(html).toContain("ALL of these");
    expect(html).toContain("Set value");
    expect(html).toContain("+ Add condition");
    expect(change).not.toHaveBeenCalled();
  });

  it("keeps FROM, WHERE, ORDER BY, direction, count, shortage, and fallback in one Selection surface", () => {
    const html = renderToStaticMarkup(<SelectionComposer
      direction="descending" count={2} shortagePolicy="choose_all"
      strategy={strategy} universeComponentId="universe"
      valueExpression={candidateReturn}
      universeMembersEditor={<button>Edit SPY, QQQ</button>}
      eligibilitySummary="Candidate's current adjusted price ≥ $5"
      eligibilityEditor={<button>Edit eligibility</button>}
      fallbackSummary="TLT" fallbackEditor={<button>Edit fallback</button>}
      onChange={vi.fn()}
    />);
    for (const label of ["FROM", "WHERE", "ORDER BY", "DIRECTION", "TAKE", "WHEN FEWER QUALIFY", "SELECTION FALLBACK"]) expect(html).toContain(label);
    expect(html.indexOf("FROM")).toBeLessThan(html.indexOf("Edit SPY, QQQ"));
    expect(html).toContain("Candidate&#x27;s current adjusted price ≥ $5");
    expect(html).toContain("Candidate&#x27;s 63-observation return");
    expect(html).toContain("Highest first");
    expect(html).toContain("Choose all eligible");
    expect(html).toContain("TLT");
    expect(html).not.toContain("Return period");
    expect(html).not.toContain("Candidate Universe");
  });

  it("shows all candidates only when Selection has no Eligibility", () => {
    const html = renderToStaticMarkup(<SelectionComposer direction="ascending" count={1} shortagePolicy="require_full" onChange={vi.fn()} />);
    expect(html).toContain("All candidates qualify");
    expect(html).not.toContain("Edit eligibility");
  });

  it("uses backend executable capability discovery and hides unsupported Strategy Values", () => {
    const capabilities = [
      { id: "market.price.current", label: "Current adjusted price", input_types: ["asset"], output_type: "money_per_share", parameters: [], canonical_supported: true, dataset_evaluation_supported: true, strategy_compiler_supported: true, capability_level: "executable", provider_requirement: "prices" },
      { id: "indicator.rsi", label: "RSI", input_types: ["asset"], output_type: "decimal", parameters: ["period"], canonical_supported: false, dataset_evaluation_supported: false, strategy_compiler_supported: false, capability_level: "semantic_only", provider_requirement: "prices" },
    ] as never;
    const html = renderToStaticMarkup(<ValueComposer expression={null} strategy={strategy} capabilities={capabilities} allowCandidate={false} initiallyOpen onChange={vi.fn()} />);
    expect(html).toContain("Current adjusted price");
    expect(html).not.toContain("Trailing return");
    expect(html).not.toContain(">RSI<");
    expect(html).not.toContain("Scale");
    expect(html).toContain("Only executable Strategy values");
  });
});
