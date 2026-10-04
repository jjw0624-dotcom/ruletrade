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
    expect(html).toContain("20 trading days");
    expect(html).toContain("Add ALL clause");
  });

  it("renders direction, count, and shortage controls together", () => {
    const html = renderToStaticMarkup(<SelectionComposer direction="descending" count={3} shortagePolicy="require_full" onChange={vi.fn()} />);
    expect(html).toContain("Highest first");
    expect(html).toContain("Lowest first");
    expect(html).toContain("Choose all eligible");
    expect(html).toContain('value="3"');
  });
});
