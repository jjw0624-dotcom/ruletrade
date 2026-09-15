import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

import type { BacktestRunRecord } from "../backtestRunApi";

export function WorkspaceActivity({
  revisionId,
  revisionCount,
  runs,
  status,
  onOpenRun,
}: {
  revisionId: string | null;
  revisionCount?: number;
  runs: BacktestRunRecord[];
  status: "loading" | "loaded" | "error";
  onOpenRun?: (runId: string) => void;
}) {
  return <section className="workspace-activity">
      <header><span className="eyebrow">Strategy activity</span><h2>Saved research</h2><p>Open an existing result without running the strategy again.</p></header>
      {revisionId && <section className="dashboard-revision"><span>Current version{revisionCount && revisionCount > 1 ? ` · ${revisionCount - 1} earlier` : ""}</span><code>{revisionId.slice(0, 8)}</code></section>}
      <section className="dashboard-runs">
        <h3>Backtests</h3>
        {status === "loading" && <p role="status">Loading saved results…</p>}
        {status === "error" && <p>Saved results are temporarily unavailable.</p>}
        {status === "loaded" && runs.length === 0 && <p>No saved backtests yet.</p>}
        {runs.map((run) => <button key={run.id} onClick={() => onOpenRun?.(run.id)}>
          <span><strong>{new Date(run.created_at).toLocaleDateString()}</strong><small>{run.run_config.start_date} – {run.run_config.end_date}{run.revision_id !== revisionId ? " · Earlier version" : ""}</small></span>
          <span className={`run-status ${run.status}`}>{run.candidate_id ? "Candidate" : run.status === "succeeded" && run.result
            ? new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1 }).format(Number(run.result.total_return))
            : run.status}</span>
        </button>)}
      </section>
    </section>;
}

export function WorkspaceResearchRail({
  open,
  hasActivity,
  onToggle,
}: {
  open: boolean;
  hasActivity: boolean;
  onToggle: () => void;
}) {
  return <Tooltip.Provider delayDuration={350}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="research-rail" aria-label={open ? "Close research" : "Open strategy activity and research"} aria-expanded={open} onClick={onToggle}>
          <span aria-hidden="true">{open ? "›" : "‹"}</span>
          {hasActivity && <i aria-hidden="true" />}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="workspace-tooltip" side="left" sideOffset={8}>{open ? "Close research" : "Strategy activity"}<Tooltip.Arrow className="workspace-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>;
}

export function WorkspaceResearchSurface({
  title,
  onClose,
  onHistory,
  children,
}: {
  title: string;
  onClose: () => void;
  onHistory: () => void;
  children: ReactNode;
}) {
  return <aside className="workspace-research-surface" aria-label="Strategy research">
    <header className="research-surface-chrome">
      <button className="text-button" onClick={onHistory}>Activity</button>
      <strong>{title}</strong>
      <button className="close-button" aria-label="Close research" onClick={onClose}>×</button>
    </header>
    <div className="research-surface-content">{children}</div>
  </aside>;
}
