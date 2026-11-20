import type { ChallengeSubmissionRecord } from "./challengeApi";

export interface ChallengeParameterChange {
  parameter: string;
  before: unknown;
  after: unknown;
}

export interface ChallengeProgress {
  previous: ChallengeSubmissionRecord;
  delta: number;
  outcome: "improved" | "declined" | "unchanged";
  changes: ChallengeParameterChange[];
}

const comparableValue = (value: unknown) => JSON.stringify(value);

export function challengeProgress(
  latest: ChallengeSubmissionRecord,
  submissions: ChallengeSubmissionRecord[],
): ChallengeProgress | null {
  if (!latest.strategy_id || !latest.eligible || latest.score === null) return null;
  const previous = submissions
    .filter((item) =>
      item.id !== latest.id
      && item.strategy_id === latest.strategy_id
      && item.eligible
      && item.score !== null
      && new Date(item.created_at).getTime() <= new Date(latest.created_at).getTime())
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (!previous || previous.score === null) return null;

  const delta = Number(latest.score) - Number(previous.score);
  const direction = latest.objective.direction;
  const outcome = delta === 0
    ? "unchanged"
    : (direction === "maximize" ? delta > 0 : delta < 0) ? "improved" : "declined";
  const ignored = new Set(["catalog_id", "version", "name"]);
  const parameters = new Set([
    ...Object.keys(previous.catalog_parameters),
    ...Object.keys(latest.catalog_parameters),
  ]);
  const changes = [...parameters]
    .filter((parameter) => !ignored.has(parameter))
    .filter((parameter) => comparableValue(previous.catalog_parameters[parameter]) !== comparableValue(latest.catalog_parameters[parameter]))
    .sort()
    .map((parameter) => ({
      parameter,
      before: previous.catalog_parameters[parameter],
      after: latest.catalog_parameters[parameter],
    }));
  return { previous, delta, outcome, changes };
}
