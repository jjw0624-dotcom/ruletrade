import * as Collapsible from "@radix-ui/react-collapsible";

import type { BacktestRunRecord } from "../backtestRunApi";
import { useStrategyEditor } from "../store/editorStore";

export function WorkspaceDashboard({
  revisionId,
  runs,
  status,
  onOpenRun,
}: {
  revisionId: string | null;
  runs: BacktestRunRecord[];
  status: "loading" | "loaded" | "error";
  onOpenRun?: (runId: string) => void;
}) {
  const { state, dispatch } = useStrategyEditor();
  return <Collapsible.Root
    className="dashboard-root"
    open={state.editor.dashboardOpen}
    onOpenChange={(open) => dispatch({ type: "set_dashboard_open", open })}
  >
    <Collapsible.Trigger className="dashboard-rail" aria-label={state.editor.dashboardOpen ? "Close Dashboard" : "Open Dashboard"}>
      <span>Dashboard</span><b>{state.editor.dashboardOpen ? "›" : "‹"}</b>
    </Collapsible.Trigger>
    <Collapsible.Content className="workspace-dashboard">
      <header><span className="eyebrow">Strategy dashboard</span><h2>Saved work</h2></header>
      {revisionId && <section className="dashboard-revision"><span>Current version</span><code>{revisionId.slice(0, 8)}</code></section>}
      <section className="dashboard-runs">
        <h3>Backtests</h3>
        {status === "loading" && <p role="status">Loading saved results…</p>}
        {status === "error" && <p>Saved results are temporarily unavailable.</p>}
        {status === "loaded" && runs.length === 0 && <p>No saved backtests yet.</p>}
        {runs.map((run) => <button key={run.id} onClick={() => onOpenRun?.(run.id)}>
          <span><strong>{new Date(run.created_at).toLocaleDateString()}</strong><small>{run.run_config.start_date} – {run.run_config.end_date}{run.revision_id !== revisionId ? " · Earlier version" : ""}</small></span>
          <span className={`run-status ${run.status}`}>{run.status === "succeeded" && run.result
            ? new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1 }).format(Number(run.result.total_return))
            : run.status}</span>
        </button>)}
      </section>
    </Collapsible.Content>
  </Collapsible.Root>;
}
