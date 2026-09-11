import type { SaveRevisionResponse } from "../strategyApi";

export type AdoptionRequestState = "idle" | "confirming" | "keeping" | "success" | "conflict" | "error";

export interface AdoptionMessage {
  title: string;
  message: string;
  actionLabel?: string;
  kind: "conflict" | "error";
}

export function canSubmitAdoption(state: AdoptionRequestState): boolean {
  return state === "confirming";
}

export function adoptionDestination(response: SaveRevisionResponse) {
  return { strategyId: response.strategy.id, revisionId: response.revision.id };
}

export function adoptionErrorMessage(code: string): AdoptionMessage {
  switch (code) {
    case "stale_revision":
      return {
        kind: "conflict",
        title: "This strategy changed since this experiment was created.",
        message: "Your comparison is still here. Open the latest strategy before deciding what to try next.",
        actionLabel: "Open latest strategy",
      };
    case "candidate_adoption_lineage_mismatch":
      return {
        kind: "conflict",
        title: "This change no longer matches the strategy.",
        message: "Nothing was overwritten, and this comparison is still available.",
        actionLabel: "Open latest strategy",
      };
    case "strategy_archived":
    case "archived_strategy":
      return {
        kind: "conflict",
        title: "This strategy is archived.",
        message: "The tested change cannot be kept unless the strategy is available again.",
      };
    case "candidate_not_found":
    case "strategy_not_found":
    case "not_found":
      return {
        kind: "error",
        title: "This experiment could not be found.",
        message: "The comparison remains available, but the change cannot be kept.",
      };
    default:
      return {
        kind: "error",
        title: "We couldn't keep this change.",
        message: "Nothing changed in your strategy. Try again when the service is available.",
      };
  }
}
