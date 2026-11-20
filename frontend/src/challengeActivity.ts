import type { ChallengeAttemptRecord, ChallengeSubmissionRecord } from "./challengeApi";

export type ChallengeActivityStatus = "not_started" | "in_progress" | "submitted";

export interface ChallengeActivity {
  status: ChallengeActivityStatus;
  activeAttempts: number;
  submissions: number;
}

export function summarizeChallengeActivity(
  attempts: ChallengeAttemptRecord[],
  submissions: ChallengeSubmissionRecord[],
): ChallengeActivity {
  const activeAttempts = attempts.filter((item) => item.status === "active").length;
  return {
    status: activeAttempts > 0
      ? "in_progress"
      : submissions.length > 0
        ? "submitted"
        : "not_started",
    activeAttempts,
    submissions: submissions.length,
  };
}

export function challengeActivityLabel(activity: ChallengeActivity): string {
  if (activity.status === "in_progress") return "In progress";
  if (activity.status === "submitted") return "Submitted";
  return "Not started";
}
