import { describe, expect, it } from "vitest";
import { blockyFilterSpecErrors, normalizeBlockyFilterSpec } from "./blockyFilterSpec";

describe("Blocky Filter Inspector specification", () => {
  it("normalizes an Inspector condition list without adding predicate sockets to Canvas", () => {
    expect(normalizeBlockyFilterSpec({
      combination: "any",
      conditions: [
        { id: "positive", metric: "trailing_return", lookbackObservations: 126, operator: "gt", value: 0 },
        { id: "price", metric: "current_price", operator: "gte", value: 10 },
      ],
    })).toEqual({
      version: 1,
      combination: "any",
      missingPolicy: "exclude",
      conditions: [
        { id: "positive", metric: "trailing_return", lookbackObservations: 126, operator: "gt", value: 0, unit: "percent" },
        { id: "price", metric: "current_price", lookbackObservations: null, operator: "gte", value: 10, unit: "usd_per_share" },
      ],
    });
  });

  it("requires a condition before an executable graph snapshot can be compiled", () => {
    const spec = normalizeBlockyFilterSpec(null);
    expect(blockyFilterSpecErrors(spec)).toEqual(["Add at least one Filter condition."]);
  });
});
