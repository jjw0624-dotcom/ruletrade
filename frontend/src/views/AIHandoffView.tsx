import { useEffect, useMemo, useState } from "react";
import { authoringApi } from "../structuralAuthoringApi";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { decisionEvidenceApi, type DecisionEventDetail } from "../decisionEvidenceApi";
import { aiContext, describeChange, parseChangeProposal, type ChangeProposalV0 } from "../domain/aiHandoff";
import { useStrategyEditor } from "../store/editorStore";
import { isBlankWorkspaceTarget } from "../domain/semanticSelection";

interface Preview { proposal: ChangeProposalV0; source: object; changes: string[] }

export function AIHandoffView({ structural, revisionId, researchContext }: { structural: StructuralAuthoringController; revisionId: string | null; researchContext: { runId: string; sessionId: string; asset: string | null } | null }) {
  const { state, dispatch } = useStrategyEditor();
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionEventDetail[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!researchContext) { setDecision(null); return; }
    let active = true; setDecision(null);
    decisionEvidenceApi.list(researchContext.runId).then(async ({ items }) => {
      const sameSession = items.filter((item) => item.session_id === researchContext.sessionId);
      const details = await Promise.all(sameSession.map((item) => decisionEvidenceApi.get(researchContext.runId, item.id)));
      if (active) setDecision(details);
    }).catch(() => { if (active) setDecision(null); });
    return () => { active = false; };
  }, [researchContext?.runId, researchContext?.sessionId]);
  const context = useMemo(() => aiContext(state.canonical, state.registry, structural.capabilities, selectedOnly ? state.editor.selection : null, revisionId,
    researchContext && decision ? { ...researchContext, events: decision } : null), [state.canonical, state.registry, structural.capabilities, selectedOnly, state.editor.selection, revisionId, researchContext, decision]);
  const markdown = `# RuleTrade Strategy context\n\n${context.explanation}\n\nThe following JSON contains the working Canonical, exact component provenance, supported capabilities, and proposal output instructions. Decision evidence, if present, records information available at decision time; later outcomes are separate.\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  const currentPreview = preview?.source === state.canonical ? preview : null;
  async function validateProposal() {
    if (!structural.capabilities) { setStatus("Capabilities are still loading."); return; }
    setChecking(true); setPreview(null); setStatus(null);
    const source = state.canonical;
    try {
      const proposal = parseChangeProposal(input, structural.capabilities);
      const result = await authoringApi.apply(source, proposal.operations[0]);
      setPreview({ proposal, source, changes: describeChange(source, result, proposal.operations[0]) });
      setStatus("Preview validated by the backend. No Strategy change has been applied.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Proposal could not be validated."); }
    finally { setChecking(false); }
  }
  async function applyPreview() {
    if (!currentPreview) { setStatus("The Strategy changed. Preview this proposal again."); return; }
    const accepted = await structural.apply(currentPreview.proposal.operations[0]);
    if (accepted) { setPreview(null); setStatus("Applied through the Authoring Contract. Review all representations, then Save."); }
    else setStatus("The backend rejected the change. The Strategy is unchanged.");
  }
  return <div className="ai-handoff-representation" onClick={(event) => { if (isBlankWorkspaceTarget(event.target)) dispatch({ type: "select_semantic", selection: null }); }}><header className="representation-intro"><span className="eyebrow">AI handoff</span><h1>Bring your own AI</h1><p>Copy a visible Strategy context for an external model, then review a proposed change here. Nothing is sent to a model by RuleTrade.</p></header>
    <section className="ai-handoff-section"><h2>Copy context</h2><label><input type="checkbox" checked={selectedOnly} disabled={!state.editor.selection?.componentId} onChange={(event) => setSelectedOnly(event.target.checked)} /> Emphasize selected Strategy object</label>
      <textarea aria-label="Context to copy for AI" readOnly value={markdown} rows={12} /><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(markdown).then(() => setStatus("Context copied.")).catch(() => setStatus("Copy failed; select the text above manually."))}>Copy for AI</button>
      {researchContext && !decision && <p>Saved Decision context is loading or unavailable. Strategy context remains available.</p>}
    </section>
    <section className="ai-handoff-section"><h2>Paste one proposal</h2><p>Proposal v0 accepts one supported semantic operation. Pasting and previewing do not edit the Strategy.</p><textarea aria-label="Paste RuleTrade change proposal" value={input} onChange={(event) => { setInput(event.target.value); setPreview(null); }} rows={7} placeholder={'{"format":"ruletrade.change-proposal/v0","operations":[{"kind":"update_qualification_threshold","component_id":"EXACT_ID","threshold":"0.05"}]}'} />
      <button className="secondary-button" disabled={checking || !input.trim()} onClick={() => void validateProposal()}>{checking ? "Checking…" : "Preview change"}</button>
      {currentPreview && <div className="ai-proposal-preview"><h3>Proposed Strategy change</h3><p>{currentPreview.proposal.operations[0].kind}</p><ul>{currentPreview.changes.map((change) => <li key={change}>{change}</li>)}</ul><button className="primary-button" disabled={structural.status === "applying"} onClick={() => void applyPreview()}>Apply to working Strategy</button></div>}
      {status && <p role="status">{status}</p>}{structural.error && <p role="alert" className="structural-error">{structural.error.message}</p>}
    </section>
  </div>;
}
