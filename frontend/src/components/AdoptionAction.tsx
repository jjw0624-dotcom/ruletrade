import { useState } from "react";
import { candidateApi, CandidateApiError } from "../candidateApi";
import type { SaveRevisionResponse } from "../strategyApi";
import {
  adoptionErrorMessage,
  canSubmitAdoption,
  type AdoptionMessage,
  type AdoptionRequestState,
} from "../domain/candidateAdoption";

export function AdoptionAction({
  candidateId,
  expectedCurrentRevisionId,
  onReturn,
  onAdopted,
  onOpenLatest,
}: {
  candidateId: string;
  expectedCurrentRevisionId: string;
  onReturn: () => void;
  onAdopted: (response: SaveRevisionResponse) => void;
  onOpenLatest?: (revisionId: string) => void;
}) {
  const [state, setState] = useState<AdoptionRequestState>("idle");
  const [problem, setProblem] = useState<AdoptionMessage | null>(null);
  const [latestRevisionId, setLatestRevisionId] = useState<string | null>(null);

  async function keep() {
    if (!canSubmitAdoption(state)) return;
    setState("keeping");
    setProblem(null);
    try {
      const response = await candidateApi.adopt(candidateId, expectedCurrentRevisionId);
      setState("success");
      onAdopted(response);
    } catch (reason) {
      const detail = reason instanceof CandidateApiError
        ? reason.detail
        : { code: "request_failed", message: "The adoption request failed." };
      const message = adoptionErrorMessage(detail.code);
      setLatestRevisionId(
        reason instanceof CandidateApiError && "current_revision_id" in reason.detail
          ? String(reason.detail.current_revision_id ?? "")
          : null,
      );
      setProblem(message);
      setState(message.kind);
    }
  }

  return <section className="comparison-decision" aria-labelledby="comparison-decision-title">
    <div>
      <span className="eyebrow">Next step</span>
      <h2 id="comparison-decision-title">What do you want to do?</h2>
      <p>Return to the original result, or keep this tested change as part of your strategy.</p>
    </div>
    {problem && <div className={problem.kind === "conflict" ? "adoption-message warning" : "adoption-message error"} role="alert">
      <strong>{problem.title}</strong>
      <p>{problem.message}</p>
      {problem.actionLabel && onOpenLatest && latestRevisionId && <button className="secondary-button" onClick={() => onOpenLatest(latestRevisionId)}>{problem.actionLabel}</button>}
    </div>}
    {state === "confirming" && <div className="keep-confirmation" role="alertdialog" aria-label="Keep this change?">
      <strong>Keep this change?</strong>
      <p>This tested change will become the current version of your strategy.</p>
      <div><button className="text-button" onClick={() => setState("idle")}>Not yet</button><button className="primary-button" onClick={() => void keep()}>Yes, keep change</button></div>
    </div>}
    <div className="comparison-decision-actions">
      <button className="secondary-button" onClick={onReturn} disabled={state === "keeping"}>← Return to original</button>
      <button className="primary-button" onClick={() => setState("confirming")} disabled={state === "keeping" || state === "confirming"}>
        {state === "keeping" ? "Keeping change…" : "Keep change"}
      </button>
    </div>
  </section>;
}
