import { describe, expect, it, vi } from "vitest";
import type { CanonicalStrategyV2 } from "../domain/canonicalV2";
import { runQuickTestFromCommittedRevision } from "./V2StrategyEditor";

const canonical = { program: { statements: [] } } as unknown as CanonicalStrategyV2;

describe("V2 Quick Test revision ownership", () => {
  it("executes the exact revision returned by the CAS-save boundary", async () => {
    const order: string[] = [];
    const execute = vi.fn(async (revision: { canonical: CanonicalStrategyV2; revisionId: string }) => {
      order.push(`run:${revision.revisionId}`);
      return { runId: "run-2", revisionId: revision.revisionId };
    });

    const result = await runQuickTestFromCommittedRevision(async () => {
      order.push("save:revision-2");
      return { canonical, revisionId: "revision-2" };
    }, execute);

    expect(order).toEqual(["save:revision-2", "run:revision-2"]);
    expect(execute).toHaveBeenCalledWith({ canonical, revisionId: "revision-2" });
    expect(result).toEqual({ runId: "run-2", revisionId: "revision-2" });
  });

  it("does not execute when validation, saving, or CAS conflict handling produces no revision", async () => {
    const execute = vi.fn();
    await expect(runQuickTestFromCommittedRevision(async () => null, execute)).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
