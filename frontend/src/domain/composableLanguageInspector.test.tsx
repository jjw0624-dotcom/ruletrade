import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ConditionComposer } from "../components/ConditionComposer";
import { SelectionComposer } from "../components/SelectionComposer";

describe("composable language inspector controls", () => {
  it("renders Candidate eligibility as an ALL composer", () => {
    const html = renderToStaticMarkup(<ConditionComposer role="eligibility" defaultLookback={20} expression={{
      kind: "comparison", operator: "gt",
      left: { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: { kind: "candidate" }, parameters: { lookback_bars: 20 } },
      right: { kind: "literal", value_type: "percentage", value: 0 },
    }} onChange={vi.fn()} />);
    expect(html).toContain("Candidate eligibility (ALL)");
    expect(html).toContain("Candidate trailing return · 20 completed observations");
    expect(html).toContain("Add ALL comparison");
    expect(html).toContain("Left value");
    expect(html).toContain("Right value");
  });

  it("renders direction, count, and shortage controls together", () => {
    const html = renderToStaticMarkup(<SelectionComposer direction="descending" count={3} shortagePolicy="require_full" onChange={vi.fn()} />);
    expect(html).toContain("Highest first");
    expect(html).toContain("Lowest first");
    expect(html).toContain("Choose all eligible");
    expect(html).toContain('value="3"');
    expect(html).toContain("Where");
  });

  it("renders executable current and rolling price value choices", () => {
    const strategy = {
      api_version: "ruletrade.dev/strategy/v1", metadata: { name: "Values", description: "", tags: [] }, random_seed: 0,
      definitions: { asset_sets: [{ id: "assets", assets: ["SPY", "QQQ"] }], parameters: [], state: [] },
      graph: { components: [], connections: [] }, entrypoints: [],
    } as never;
    const html = renderToStaticMarkup(<ConditionComposer role="predicate" strategy={strategy} expression={{
      kind: "comparison", operator: "gt",
      left: { kind: "current", series: { kind: "market_series", field: "price", subject: { kind: "literal", value_type: "asset", value: "SPY" } } },
      right: { kind: "literal", value_type: "money_per_share", value: 100 },
    }} onChange={vi.fn()} />);
    expect(html).toContain("Current adjusted price");
    expect(html).toContain("Rolling adjusted price");
    expect(html).toContain("Constant");
    expect(html).toContain("SPY price · current");
  });
});
