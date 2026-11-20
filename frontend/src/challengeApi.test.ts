import { describe, expect, it, vi } from "vitest";

import { challengeApi } from "./challengeApi";

describe("Challenge API", () => {
  it("submits an exact saved Revision to a server-owned challenge", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      submission: {
        id: "submission-1", challenge_id: "learn-1", challenge_version: 1,
        policy_version: 1, revision_id: "revision-1", run_id: "run-1",
        catalog_id: "single_asset_periodic", catalog_parameters: {},
        eligible: true, violations: [], score: "0.1",
        objective: { metric: "total_return", direction: "maximize" },
        created_at: "2026-11-20T00:00:00Z",
      },
      run: { id: "run-1" },
    }), { status: 201, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const execution = await challengeApi.submit("learn-1", "revision-1", fetcher);

    expect(execution.submission.score).toBe("0.1");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v2/challenges/learn-1/submissions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String((fetcher as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body));
    expect(body).toEqual({ revision_id: "revision-1" });
  });

  it("loads the server-owned catalog and ranked submissions", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input).endsWith("/submissions") ? { items: [{ id: "s1" }] } : { items: [{ id: "learn-1" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    expect((await challengeApi.list(fetcher)).items[0]?.id).toBe("learn-1");
    expect((await challengeApi.submissions("learn-1", fetcher)).items[0]?.id).toBe("s1");
  });

  it("loads durable challenge and submission objects directly", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("challenge-submissions")
        ? { id: "submission-1", challenge_id: "learn-1", revision_id: "revision-1" }
        : { id: "learn-1", kind: "learning" };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    expect((await challengeApi.get("learn-1", fetcher)).kind).toBe("learning");
    expect((await challengeApi.getSubmission("submission-1", fetcher)).revision_id).toBe("revision-1");
    expect(fetcher).toHaveBeenCalledWith("/api/v2/challenge-submissions/submission-1", {});
  });
});
