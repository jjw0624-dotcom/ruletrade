import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceActivity, WorkspaceResearchRail } from "../components/WorkspaceDashboard";
import { StrategyBuilderWorkspace } from "../components/StrategyBuilderWorkspace";
import { StrategyEditorProvider, createEditorState, editorReducer } from "../store/editorStore";
import { sleevesBootstrap } from "../test/fixture";
import { flowNodeIdForSelection, projectFlowCanvas } from "../views/FlowView";
import { projectConceptualFlow } from "./conceptualFlow";
import { semanticSelection } from "./semanticSelection";
import {
  INITIAL_WORKBENCH_RESEARCH,
  workbenchResearchReducer,
} from "./workbenchResearch";

const run = {
  id: "run-1",
  revision_id: "revision-1",
  candidate_id: null,
  status: "succeeded" as const,
  run_config: {
    backend_id: "lean" as const,
    dataset_id: "us-equity-daily-local" as const,
    start_date: "2025-01-01",
    end_date: "2025-12-31",
    initial_cash: "100000",
  },
  result: {
    initial_value: "100000",
    final_value: "110000",
    total_return: "0.1",
    total_orders: 2,
    total_fees: "0",
    equity_curve: [],
  },
  error: null,
  provenance: {
    source_hash: "hash",
    strategy_schema_version: "1",
    application_version: "test",
    build_commit: null,
    backend_id: "lean" as const,
    engine_image: null,
    dataset_id: "us-equity-daily-local",
    dataset_version: null,
  },
  timings: { total_ms: 1, source_load_ms: 0, validation_ms: 0, compiler_ms: 1, codegen_ms: 0, csharp_compile_ms: 0, lean_execution_ms: 0, result_load_ms: 0, normalization_ms: 0 },
  created_at: "2025-12-31T00:00:00Z",
  started_at: "2025-12-31T00:00:00Z",
  completed_at: "2025-12-31T00:00:01Z",
};

describe("integrated Strategy research workbench", () => {
  it("mounts Research beside the same Builder representation tree", () => {
    const projection = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const structural = { capabilities: null, status: "ready" as const, error: null, apply: async () => false };
    const markup = renderToStaticMarkup(<StrategyEditorProvider bootstrap={sleevesBootstrap}>
      <StrategyBuilderWorkspace name="Integrated strategy" dirty={false} saving={false} persisted projection={projection} structural={structural} research={{ open: true, size: 42, title: "Saved result", hasActivity: true, content: <p>Persisted result</p>, onToggle: () => undefined, onHistory: () => undefined, onResize: () => undefined }} onHome={() => undefined} onRename={() => undefined} onSave={() => undefined} onTest={() => undefined} />
    </StrategyEditorProvider>);
    expect(markup).toContain("Summary representation");
    expect(markup).toContain("Strategy research");
    expect(markup).toContain("Persisted result");
  });

  it("opens exact persisted Run context without touching Strategy semantic state", () => {
    const editor = createEditorState(sleevesBootstrap, "guided");
    const canonical = editor.canonical;
    const context = { runId: "run-1", sessionId: "2025-06-02", asset: "VGT" };
    const research = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, {
      type: "open_run",
      runId: "run-1",
      context,
    });
    expect(research).toMatchObject({ open: true, destination: { kind: "run", runId: "run-1" }, context });
    expect(editor.canonical).toBe(canonical);
  });

  it("keeps representation, selection, dirty status, close, and resize out of Canonical", () => {
    const initial = createEditorState(sleevesBootstrap, "flow");
    const selected = editorReducer(initial, { type: "select_semantic", selection: semanticSelection("qualification", "positive_return", { fieldPath: "config.threshold" }) });
    const summary = editorReducer(selected, { type: "set_active_view", view: "overview" });
    const opened = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_history" });
    const resized = workbenchResearchReducer(opened, { type: "set_size", size: 65 });
    const closed = workbenchResearchReducer(resized, { type: "close" });
    const reopened = workbenchResearchReducer(closed, { type: "reopen" });
    expect(summary.canonical).toBe(initial.canonical);
    expect(summary.editor.selection).toEqual(selected.editor.selection);
    expect(summary.validation.status).toBe("valid");
    expect(closed).toMatchObject({ open: false, size: 65, destination: { kind: "history" } });
    expect(reopened).toMatchObject({ open: true, size: 65, destination: { kind: "history" } });
  });

  it("maps exact semantic identity to the xyflow node used by View in Flow", () => {
    const nodes = projectFlowCanvas(projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry)).nodes;
    expect(flowNodeIdForSelection(nodes, semanticSelection("rule", "positive_return", { fieldPath: "config.threshold" }))).toBe("qualification:growth_sleeve");
    expect(flowNodeIdForSelection(nodes, semanticSelection("rule", "same-looking-but-unrelated", { fieldPath: "config.threshold" }))).toBeNull();
  });

  it("presents one compact rail and persisted activity without execution controls", () => {
    const rail = renderToStaticMarkup(<WorkspaceResearchRail open={false} hasActivity onToggle={() => undefined} />);
    const activity = renderToStaticMarkup(<WorkspaceActivity revisionId="revision-1" revisionCount={2} runs={[run]} status="loaded" onOpenRun={() => undefined} />);
    expect(rail).toContain("Open strategy activity and research");
    expect(rail).not.toContain(">Dashboard<");
    expect(activity).toContain("Saved research");
    expect(activity).toContain("1 earlier");
    expect(activity).toContain("Open an existing result without running the strategy again");
    expect(activity).not.toContain("Test strategy");
  });

  it("preserves exact context while moving from Result to Comparison and back", () => {
    const context = { runId: "run-1", sessionId: "2025-06-02", asset: "VGT" };
    const result = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_run", runId: "run-1", context });
    const comparison = workbenchResearchReducer(result, { type: "open_comparison", comparisonId: "comparison-1", context });
    const returned = workbenchResearchReducer(comparison, { type: "open_run", runId: "run-1", context });
    expect(returned.context).toEqual(context);
    expect(returned.destination).toEqual({ kind: "run", runId: "run-1" });
  });
});
