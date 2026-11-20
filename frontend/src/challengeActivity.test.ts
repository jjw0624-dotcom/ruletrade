import { describe, expect, it } from "vitest";

import { challengeActivityLabel, summarizeChallengeActivity } from "./challengeActivity";
import type { ChallengeAttemptRecord, ChallengeSubmissionRecord } from "./challengeApi";

const attempt = (status: "active" | "submitted"): ChallengeAttemptRecord => ({
  id: `attempt-${status}`,
  challenge_id: "learn-1",
  challenge_version: 1,
  strategy_id: "strategy-1",
  status,
  latest_submission_id: status === "submitted" ? "submission-1" : null,
  created_at: "2026-11-20T00:00:00Z",
  updated_at: "2026-11-20T00:00:00Z",
});

describe("challenge activity", () => {
  it("distinguishes untouched, active, and submitted problems", () => {
    const untouched = summarizeChallengeActivity([], []);
    const active = summarizeChallengeActivity([attempt("active")], []);
    const submitted = summarizeChallengeActivity(
      [attempt("submitted")],
      [{ id: "submission-1" } as ChallengeSubmissionRecord],
    );

    expect(challengeActivityLabel(untouched)).toBe("Not started");
    expect(challengeActivityLabel(active)).toBe("In progress");
    expect(challengeActivityLabel(submitted)).toBe("Submitted");
  });

  it("prioritizes an active iteration after an earlier submission", () => {
    const activity = summarizeChallengeActivity(
      [attempt("submitted"), attempt("active")],
      [{ id: "submission-1" } as ChallengeSubmissionRecord],
    );

    expect(activity).toEqual({
      status: "in_progress",
      activeAttempts: 1,
      submissions: 1,
    });
  });
});
