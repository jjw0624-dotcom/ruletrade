import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConditionComposer } from "../components/ConditionComposer";
import { SelectionComposer } from "../components/SelectionComposer";

describe("composable language inspector controls", () => {
  it("edits Candidate eligibility as an ALL expression", () => {
    const onChange = vi.fn();
    render(<ConditionComposer role="eligibility" defaultLookback={20} expression={{
      kind: "comparison", operator: "gt",
      left: { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: { kind: "candidate" }, parameters: { lookback_bars: 20 } },
      right: { kind: "literal", value_type: "percentage", value: 0 },
    }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add ALL clause" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "boolean", operator: "and" }));
  });

  it("emits direction, count, and shortage as one selection edit", () => {
    const onChange = vi.fn();
    render(<SelectionComposer direction="descending" count={3} shortagePolicy="require_full" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Order"), { target: { value: "ascending" } });
    expect(onChange).toHaveBeenCalledWith({ direction: "ascending", count: 3, shortagePolicy: "require_full" });
    fireEvent.change(screen.getByLabelText("When fewer qualify"), { target: { value: "choose_all" } });
    expect(onChange).toHaveBeenCalledWith({ direction: "descending", count: 3, shortagePolicy: "choose_all" });
  });
});
