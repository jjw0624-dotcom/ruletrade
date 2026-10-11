import { describe, expect, it } from "vitest";

import { V2AuthoringApiError, v2AuthoringErrorMessage } from "../v2AuthoringApi";

describe("v2 authoring product errors", () => {
  it("turns validation codes into short corrective messages", () => {
    expect(v2AuthoringErrorMessage(new V2AuthoringApiError(422, {
      code: "duplicate_asset",
      message: "internal duplicate detail",
      path: "definitions.asset_sets[0]",
    }))).toBe("Each symbol can appear only once in this investment.");
    expect(v2AuthoringErrorMessage(new V2AuthoringApiError(422, {
      code: "unbound_candidate",
      message: "internal scope detail",
    }))).toContain("Qualification or Selection ranking");
  });

  it("keeps an authoritative backend message for unknown codes", () => {
    expect(v2AuthoringErrorMessage(new V2AuthoringApiError(422, {
      code: "new_semantic_constraint",
      message: "Choose a compatible value.",
    }))).toBe("Choose a compatible value.");
  });
});
