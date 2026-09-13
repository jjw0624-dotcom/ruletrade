import { useEffect, useState } from "react";

import type { BacktestRunRecord } from "../backtestRunApi";
import {
  loadRuleEvidenceMatches,
  researchContextForMatch,
  type RuleEvidenceMatch,
  type RuleEvidenceTarget,
} from "../domain/evidenceHarvest";
import type { ResearchContext } from "../domain/researchContext";

type HistoryState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; matches: RuleEvidenceMatch[] }
  | { status: "error"; message: string };

export function RuleEvidenceHistory({
  revisionId,
  target,
  runs,
  preferredAsset,
  onOpen,
}: {
  revisionId: string;
  target: RuleEvidenceTarget;
  runs: BacktestRunRecord[];
  preferredAsset?: string | null;
  onOpen: (context: ResearchContext) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<HistoryState>({ status: "idle" });

  useEffect(() => {
    setExpanded(false);
    setState({ status: "idle" });
  }, [revisionId, target.componentId, target.fieldPath]);

  async function load() {
    setExpanded(true);
    setState({ status: "loading" });
    try {
      const matches = await loadRuleEvidenceMatches(runs, revisionId, target);
      setState({ status: "loaded", matches });
    } catch {
      setState({
        status: "error",
        message: "We couldn't check this rule's saved decisions right now.",
      });
    }
  }

  if (!expanded) {
    return <button className="secondary-button" onClick={() => void load()}>
      Show where this mattered
    </button>;
  }

  return <section className="rule-evidence-history" aria-label="Historical decisions for this rule">
    <header>
      <div><span className="eyebrow">Historical decisions</span><h3>Where this rule mattered</h3></div>
      <button className="text-button" onClick={() => setExpanded(false)}>Close</button>
    </header>
    {state.status === "loading" && <p role="status">Finding saved decisions…</p>}
    {state.status === "error" && <p role="alert">{state.message}</p>}
    {state.status === "loaded" && state.matches.length === 0
      && <div className="rule-evidence-empty"><strong>No saved decisions use this rule yet.</strong><p>Run and save a test to build historical research evidence.</p></div>}
    {state.status === "loaded" && state.matches.length > 0
      && <div className="rule-evidence-list">{state.matches.map((match) =>
        <EvidenceMatch
          key={`${match.runId}:${match.sessionId}`}
          match={match}
          preferredAsset={preferredAsset}
          onOpen={onOpen}
        />,
      )}</div>}
  </section>;
}

function EvidenceMatch({
  match,
  preferredAsset,
  onOpen,
}: {
  match: RuleEvidenceMatch;
  preferredAsset?: string | null;
  onOpen: (context: ResearchContext) => void;
}) {
  const assets = preferredAsset && match.assets.includes(preferredAsset)
    ? [preferredAsset, ...match.assets.filter((asset) => asset !== preferredAsset)]
    : match.assets;
  return <article className="rule-evidence-match">
    <div>
      <time>{new Date(`${match.sessionId}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}</time>
      <strong>{match.kinds.map(kindLabel).join(" · ")}</strong>
      <small>Saved test {match.requestedPeriod}</small>
    </div>
    <div className="rule-evidence-actions">
      {assets.length > 0
        ? assets.map((asset) => <button
            key={asset}
            className="text-button"
            onClick={() => onOpen(researchContextForMatch(match, asset))}
          >Open {asset}</button>)
        : <button
            className="text-button"
            onClick={() => onOpen(researchContextForMatch(match, null))}
          >Open decision</button>}
    </div>
  </article>;
}

function kindLabel(kind: RuleEvidenceMatch["kinds"][number]): string {
  const labels: Partial<Record<RuleEvidenceMatch["kinds"][number], string>> = {
    filter: "Qualification evaluated",
    selection: "Assets selected",
    random_selection: "Assets chosen",
    fallback: "Fallback considered",
    cooldown: "Waiting period checked",
    sleeve_contribution: "Group contributed",
    final_targets: "Portfolio updated",
  };
  return labels[kind] ?? "Strategy decision";
}
