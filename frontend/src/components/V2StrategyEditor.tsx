import { useEffect, useRef, useState } from "react";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "../domain/canonicalV2";
import type { StrategyDetailV2 } from "../strategyApi";
import { StrategyApiError, strategyApi } from "../strategyApi";
import { v2AuthoringApi, v2AuthoringErrorMessage } from "../v2AuthoringApi";
import { executeV2Selection, v2ExecutionCapability, V2ExecutionError, type V2ExecutionCapability, type V2SelectionExecution } from "../v2ExecutionApi";
import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig, type LeanBacktestResponse } from "../domain/backtest";
import { backtestRunApi, type BacktestRunRecord } from "../backtestRunApi";
import { SemanticProgramBuilderAdapter } from "./SemanticProgramBuilderAdapter";
import { CompatibilitySelectionBuilderAdapter } from "./CompatibilitySelectionBuilderAdapter";
import { browserProgramDraftStorage, loadProgramWorkingDraft, persistProgramWorkingDraft, type ProgramWorkingDraft } from "../domain/programWorkingDraft";
import { analyzeBuilderRevisionConflict, type BuilderRevisionConflictAnalysis } from "../domain/builderRevisionConflict";

interface V2RevisionConflict {
  baseRevisionId: string;
  currentRevisionId: string;
  current: StrategyDetailV2;
  analysis: BuilderRevisionConflictAnalysis;
}

function V2ConflictBanner({ conflict, draft, onRefresh, onReapply, onDiscard }: {
  conflict: V2RevisionConflict; draft: ProgramWorkingDraft;
  onRefresh: () => void; onReapply: () => void; onDiscard: () => void;
}) {
  const draftCount = Object.keys(draft.perspectiveDrafts).length + Object.keys(draft.canvasBlocks).length;
  return <section className="save-banner stale v2-conflict-banner" role="alert" aria-label="Revision conflict">
    <strong>Another saved revision is now current.</strong>
    <p>Base <code>{conflict.baseRevisionId}</code> · Current <code>{conflict.currentRevisionId}</code> · {draftCount} unfinished draft item{draftCount === 1 ? "" : "s"} preserved.</p>
    {conflict.analysis.classification === "compatible_semantic_change"
      ? <p>Your committed edits affect different semantic addresses and can be reapplied to the latest revision.</p>
      : <p>Both revisions changed {conflict.analysis.conflictPaths.join(", ")}. Choose which work to keep; RuleTrade will not overwrite it automatically.</p>}
    <div className="entry-block-actions">
      <button type="button" className="secondary-button" onClick={onRefresh}>Reload comparison</button>
      <button type="button" className="primary-button" disabled={!conflict.analysis.merged} onClick={onReapply}>Reapply my changes</button>
      <button type="button" className="text-button" onClick={onDiscard}>Discard my semantic changes</button>
    </div>
  </section>;
}

export type V2TestPanelState =
  | { status: "setup"; config: BacktestConfig }
  | { status: "running" }
  | { status: "success"; result: V2SelectionExecution | LeanBacktestResponse | BacktestRunRecord }
  | { status: "failure"; message: string; technicalDetail: string | null }
  | null;

export interface CommittedExecutionRevision {
  canonical: CanonicalStrategyV2;
  revisionId: string;
}

export async function runQuickTestFromCommittedRevision<T>(
  persist: () => Promise<CommittedExecutionRevision | null>,
  execute: (revision: CommittedExecutionRevision) => Promise<T>,
): Promise<T | null> {
  const revision = await persist();
  return revision ? execute(revision) : null;
}

export function V2TestResultPanel({ state, onOpenRun }: { state: Exclude<V2TestPanelState, null>; onOpenRun?: (runId: string) => void }) {
  if (state.status === "setup") return null;
  if (state.status === "running") return <div className="semantic-inspector-content" role="status"><h2>Testing committed strategy…</h2><p>The Builder remains available while the runtime evaluates this revision.</p></div>;
  if (state.status === "failure") return <div className="semantic-inspector-content" role="alert"><h2>Test unavailable</h2><p>{state.message}</p>{state.technicalDetail && <details><summary>Technical diagnostics</summary><pre>{state.technicalDetail}</pre></details>}</div>;
  if ("revision_id" in state.result) {
    const run = state.result;
    if (run.status !== "succeeded" || !run.result) return <div className="semantic-inspector-content" role="alert"><h2>Test did not complete</h2><p>{run.error?.message ?? "The saved Run did not produce a result."}</p><p>Run <code>{run.id}</code> remains attached to revision <code>{run.revision_id}</code>.</p></div>;
    return <div className="semantic-inspector-content"><h2>Backtest complete</h2><p>Saved Run <code>{run.id}</code> belongs to revision <code>{run.revision_id}</code>.</p><dl><div><dt>Total return</dt><dd>{run.result.total_return}</dd></div><div><dt>Final value</dt><dd>{run.result.final_value}</dd></div><div><dt>Orders</dt><dd>{run.result.total_orders}</dd></div></dl>{onOpenRun && <button type="button" className="primary-button" onClick={() => onOpenRun(run.id)}>Open result and decision evidence</button>}<details><summary>Execution provenance</summary><pre>{JSON.stringify({ provenance: run.provenance, config: run.run_config, timings: run.timings }, null, 2)}</pre></details></div>;
  }
  if ("selected_assets" in state.result) return <div className="semantic-inspector-content"><h2>{state.result.complete ? "Selection complete" : "Selection incomplete"}</h2><p>Selected: {state.result.selected_assets.join(", ") || "none"}</p></div>;
  return <div className="semantic-inspector-content"><h2>Backtest complete</h2><p>This result belongs to strategy hash <code>{state.result.strategy_hash}</code>.</p><dl><div><dt>Total return</dt><dd>{state.result.result.total_return}</dd></div><div><dt>Final value</dt><dd>{state.result.result.final_value}</dd></div><div><dt>Orders</dt><dd>{state.result.result.total_orders}</dd></div></dl><details><summary>Execution details</summary><pre>{JSON.stringify({ engine: state.result.engine, config: state.result.config, timings: state.result.timings }, null, 2)}</pre></details></div>;
}

function V2QuickTestPanel({ config, onChange, onRun }: { config: BacktestConfig; onChange: (config: BacktestConfig) => void; onRun: () => void }) {
  const valid = config.start_date <= config.end_date && Number(config.initial_cash) > 0;
  return <div className="semantic-inspector-content quick-test-panel"><h2>Quick Test</h2><p>Choose only the period and starting capital. Detailed fees, slippage, currency, cash-flow, and evidence settings belong to Detailed Backtest.</p>
    <label>Start date<input aria-label="Quick Test start date" type="date" value={config.start_date} onChange={(event) => onChange({ ...config, start_date: event.target.value })} /></label>
    <label>End date<input aria-label="Quick Test end date" type="date" value={config.end_date} onChange={(event) => onChange({ ...config, end_date: event.target.value })} /></label>
    <label>Initial capital<input aria-label="Quick Test initial capital" type="number" min="1" step="1000" value={config.initial_cash} onChange={(event) => onChange({ ...config, initial_cash: event.target.value })} /></label>
    <p className="value-capability-note">Recurring contributions are not enabled in this maintained execution profile, so Quick Test does not fabricate them.</p>
    <button type="button" className="primary-button" disabled={!valid} onClick={onRun}>Run Quick Test</button>
  </div>;
}

export function V2StrategyEditor({ persisted, onHome, onDirtyChange, onOpenRun }: {
  persisted: StrategyDetailV2;
  onHome: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const initial = persisted.current_revision.canonical_strategy;
  const [canonical, setCanonical] = useState(initial);
  const [baseCanonical, setBaseCanonical] = useState(initial);
  const [revisionId, setRevisionId] = useState(persisted.current_revision.id);
  const [sourceHash, setSourceHash] = useState(persisted.current_revision.source_hash);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"saved" | "updating" | "invalid" | "unfinished">("saved");
  const [message, setMessage] = useState("Saved");
  const [result, setResult] = useState<V2SelectionExecution | LeanBacktestResponse | BacktestRunRecord | null>(null);
  const [latestRun, setLatestRun] = useState<BacktestRunRecord | null>(null);
  const [testPanel, setTestPanel] = useState<V2TestPanelState>(null);
  const [quickTestConfig, setQuickTestConfig] = useState<BacktestConfig>(() => ({ ...DEFAULT_BACKTEST_CONFIG, dataset_id: "filter-synthetic" }));
  const [executionCapability, setExecutionCapability] = useState<V2ExecutionCapability | null>(null);
  const [undoStack, setUndoStack] = useState<typeof initial[]>([]);
  const [redoStack, setRedoStack] = useState<typeof initial[]>([]);
  const draftKey = persisted.strategy.id;
  const [workingDraft, setWorkingDraft] = useState<ProgramWorkingDraft>(() => loadProgramWorkingDraft(draftKey, browserProgramDraftStorage()));
  const [conflict, setConflict] = useState<V2RevisionConflict | null>(null);
  const sequence = useRef(0);
  const unavailable = status === "unfinished" || status === "invalid" || status === "updating";
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => persistProgramWorkingDraft(workingDraft, browserProgramDraftStorage()), [workingDraft]);
  useEffect(() => {
    if (!canonical.program) return;
    let active = true;
    void backtestRunApi.listV2(revisionId).then(({ items }) => {
      if (active) setLatestRun(items[0] ?? null);
    }).catch(() => {
      if (active) setLatestRun(null);
    });
    return () => { active = false; };
  }, [canonical.program, revisionId]);
  useEffect(() => {
    let active = true;
    void v2ExecutionCapability(canonical).then((value) => { if (active) setExecutionCapability(value); }).catch(() => {
      if (active) setExecutionCapability({ authoring_state: canonical.definitions.groups.length ? "committed" : "empty", semantic_state: "valid", execution_state: "incomplete", provider_state: "not_checked", runtime_state: "not_checked", product_message: "Execution capability could not be checked.", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: false, production_executable: false, reason: "Execution capability could not be checked." });
    });
    return () => { active = false; };
  }, [canonical]);

  const apply = async (operation: V2AuthoringOperation) => {
    const request = ++sequence.current;
    setStatus("updating"); setMessage("Updating…");
    try {
      const response = await v2AuthoringApi.apply(canonical, sourceHash, operation);
      if (request !== sequence.current) return;
      setUndoStack((items) => [...items, canonical]);
      setRedoStack([]);
      setCanonical(response.strategy);
      setSourceHash(response.source_hash);
      setDirty(true);
      setStatus("saved"); setMessage("Updated");
    } catch (reason) {
      if (request !== sequence.current) return;
      setStatus("invalid");
      setMessage(v2AuthoringErrorMessage(reason));
    }
  };
  const restore = async (target: typeof canonical, direction: "undo" | "redo") => {
    const historyOperation = (): V2AuthoringOperation | null => {
      const removedInvestment = canonical.definitions.groups.find((group) => !target.definitions.groups.some((item) => item.id === group.id));
      if (removedInvestment) return { kind: "remove_program_investment", investment_id: removedInvestment.id };
      const addedInvestment = target.definitions.groups.find((group) => !canonical.definitions.groups.some((item) => item.id === group.id));
      if (addedInvestment) {
        const assets = target.definitions.asset_sets.find((item) => item.id === addedInvestment.asset_set_ref)?.assets ?? ["SPY"];
        return { kind: "add_program_investment", investment_id: addedInvestment.id, name: addedInvestment.name, asset_set_id: addedInvestment.asset_set_ref, assets };
      }
      const changedAssetSet = target.definitions.asset_sets.find((item) => JSON.stringify(item.assets) !== JSON.stringify(canonical.definitions.asset_sets.find((current) => current.id === item.id)?.assets));
      if (changedAssetSet && canonical.program) return { kind: "set_program_asset_set", asset_set_id: changedAssetSet.id, assets: changedAssetSet.assets };
      if (target.program) return { kind: "set_semantic_program", program: target.program };
      if (!target.selection || !canonical.selection) return null;
      if (target.selection.universe_id !== canonical.selection.universe_id) return { kind: "set_selection_universe", universe_id: target.selection.universe_id };
      if (JSON.stringify(target.selection.eligibility) !== JSON.stringify(canonical.selection.eligibility)) return { kind: "set_eligibility_condition", condition: target.selection.eligibility };
      if (JSON.stringify(target.selection.ranking) !== JSON.stringify(canonical.selection.ranking)) return { kind: "set_ranking_value", value: target.selection.ranking };
      if (target.selection.direction !== canonical.selection.direction) return { kind: "set_ranking_direction", direction: target.selection.direction };
      if (target.selection.count !== canonical.selection.count) return { kind: "set_selection_count", count: target.selection.count };
      if (target.selection.shortage_policy !== canonical.selection.shortage_policy) return { kind: "set_shortage_policy", shortage_policy: target.selection.shortage_policy };
      if (target.selection.fallback_asset !== canonical.selection.fallback_asset) return { kind: "set_selection_fallback", fallback_asset: target.selection.fallback_asset };
      return null;
    };
    const operation = historyOperation();
    if (!operation) return;
    const current = canonical;
    const request = ++sequence.current;
    setStatus("updating"); setMessage(direction === "undo" ? "Undoing…" : "Redoing…");
    try {
      const response = await v2AuthoringApi.apply(canonical, sourceHash, operation);
      if (request !== sequence.current) return;
      setCanonical(response.strategy); setSourceHash(response.source_hash); setDirty(true);
      if (direction === "undo") {
        setUndoStack((items) => items.slice(0, -1)); setRedoStack((items) => [...items, current]);
      } else {
        setRedoStack((items) => items.slice(0, -1)); setUndoStack((items) => [...items, current]);
      }
      setStatus("saved"); setMessage(direction === "undo" ? "Undone" : "Redone");
    } catch (reason) {
      if (request !== sequence.current) return;
      setStatus("invalid"); setMessage(v2AuthoringErrorMessage(reason));
    }
  };
  const persistCommittedRevision = async (): Promise<{ canonical: CanonicalStrategyV2; revisionId: string } | null> => {
    if (!dirty) return { canonical, revisionId };
    if (status !== "saved") return null;
    setStatus("updating"); setMessage("Saving revision…");
    try {
      const response = await strategyApi.save(persisted.strategy.id, revisionId, canonical);
      setCanonical(response.revision.canonical_strategy);
      setBaseCanonical(response.revision.canonical_strategy);
      setRevisionId(response.revision.id);
      setSourceHash(response.revision.source_hash);
      setDirty(false); setStatus("saved"); setMessage("Saved");
      return { canonical: response.revision.canonical_strategy, revisionId: response.revision.id };
    } catch (reason) {
      if (reason instanceof StrategyApiError && reason.detail.code === "stale_revision") {
        try {
          const current = await strategyApi.get<CanonicalStrategyV2>(persisted.strategy.id);
          setConflict({ baseRevisionId: revisionId, currentRevisionId: current.current_revision.id, current, analysis: analyzeBuilderRevisionConflict(baseCanonical, canonical, current.current_revision.canonical_strategy) });
          setStatus("invalid"); setMessage("Another revision was saved. Your work is preserved until you choose how to resolve it.");
          return null;
        } catch { /* Preserve the original stale error when the latest revision cannot be loaded. */ }
      }
      setStatus("invalid"); setMessage(reason instanceof Error ? reason.message : "Save failed.");
      return null;
    }
  };
  const save = async () => { await persistCommittedRevision(); };
  const refreshConflict = async () => {
    if (!conflict) return;
    const current = await strategyApi.get<CanonicalStrategyV2>(persisted.strategy.id);
    setConflict({ ...conflict, currentRevisionId: current.current_revision.id, current, analysis: analyzeBuilderRevisionConflict(baseCanonical, canonical, current.current_revision.canonical_strategy) });
  };
  const reapplyConflict = () => {
    if (!conflict?.analysis.merged) return;
    setCanonical(conflict.analysis.merged);
    setBaseCanonical(conflict.current.current_revision.canonical_strategy);
    setRevisionId(conflict.currentRevisionId); setSourceHash(conflict.current.current_revision.source_hash);
    setDirty(true); setStatus("saved"); setMessage("Reapplied to the latest revision. Save to commit it."); setConflict(null);
  };
  const discardConflict = () => {
    if (!conflict) return;
    const current = conflict.current.current_revision;
    setCanonical(current.canonical_strategy); setBaseCanonical(current.canonical_strategy);
    setRevisionId(current.id); setSourceHash(current.source_hash);
    setUndoStack([]); setRedoStack([]); setDirty(false); setStatus("saved"); setMessage("Loaded the latest revision. Unfinished perspective drafts were preserved."); setConflict(null);
  };
  const run = async (config = quickTestConfig) => {
    if (unavailable) return;
    const preflight = await v2ExecutionCapability(canonical, fetch, true).catch(() => null);
    if (!preflight || preflight.execution_state !== "executable" || preflight.runtime_state === "unavailable") {
      if (preflight) setExecutionCapability(preflight);
      const productMessage = preflight?.product_message ?? "Testing is unavailable right now.";
      setTestPanel({ status: "failure", message: productMessage, technicalDetail: preflight?.technical_detail ?? null });
      setStatus("saved"); setMessage(productMessage);
      return;
    }
    setExecutionCapability(preflight);
    setTestPanel({ status: "running" });
    setStatus("updating"); setMessage("Testing committed strategy…");
    try {
      const next = await runQuickTestFromCommittedRevision<V2SelectionExecution | LeanBacktestResponse | BacktestRunRecord>(persistCommittedRevision, async (executionRevision) => executionRevision.canonical.program
        ? await backtestRunApi.createV2(executionRevision.revisionId, config)
        : await executeV2Selection(executionRevision.canonical));
      if (!next) {
        setTestPanel(null);
        return;
      }
      if (canonical.program && "revision_id" in next) setLatestRun(next);
      setResult(next); setTestPanel({ status: "success", result: next }); setStatus("saved"); setMessage("Test complete");
    } catch (reason) {
      const productMessage = reason instanceof V2ExecutionError && reason.code === "runtime_unavailable"
        ? "The testing runtime is unavailable. Try again when Docker is running."
        : reason instanceof V2ExecutionError && reason.code === "market_data_unavailable"
          ? "Required market data is unavailable for this test."
          : reason instanceof Error ? reason.message : "The test could not complete.";
      if (reason instanceof V2ExecutionError && reason.code === "market_data_unavailable") {
        setExecutionCapability({ ...preflight, provider_state: "unavailable", product_message: productMessage, technical_detail: reason.message });
      }
      setTestPanel({ status: "failure", message: productMessage, technicalDetail: reason instanceof Error ? reason.message : null });
      setStatus("saved"); setMessage(productMessage);
    }
  };
  const working = (unfinished: boolean) => {
    setStatus(unfinished ? "unfinished" : "saved");
    setMessage(unfinished ? "Unfinished semantic edit" : "Ready");
  };
  if (canonical.selection === null && canonical.program) {
    return <>{conflict && <V2ConflictBanner conflict={conflict} draft={workingDraft} onRefresh={() => void refreshConflict()} onReapply={reapplyConflict} onDiscard={discardConflict} />}<SemanticProgramBuilderAdapter canonical={canonical} dirty={dirty} status={status} message={message} onHome={onHome}
      apply={(operation) => void apply(operation)} save={() => void save()}
      workingDraft={workingDraft} onWorkingDraftChange={setWorkingDraft}
      undo={() => { const target = undoStack.at(-1); if (target) void restore(target, "undo"); }}
      redo={() => { const target = redoStack.at(-1); if (target) void restore(target, "redo"); }}
      canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} working={working}
      run={() => setTestPanel({ status: "setup", config: quickTestConfig })} executionCapability={executionCapability}
      revisionContext={{ revisionId, sourceHash, schemaVersion: canonical.api_version, latestRun }}
      onOpenLatestRun={() => latestRun && setTestPanel({ status: "success", result: latestRun })}
      testPanel={testPanel ? testPanel.status === "setup" ? <V2QuickTestPanel config={quickTestConfig} onChange={(config) => { setQuickTestConfig(config); setTestPanel({ status: "setup", config }); }} onRun={() => void run(quickTestConfig)} /> : <V2TestResultPanel state={testPanel} onOpenRun={onOpenRun} /> : null} onCloseTestPanel={() => setTestPanel(null)} /></>;
  }
  if (canonical.selection === null) return null;
  return <CompatibilitySelectionBuilderAdapter canonical={canonical as typeof canonical & { selection: NonNullable<typeof canonical.selection> }} dirty={dirty} status={status} message={message}
    result={result && "selected_assets" in result && <section className="v2-test-result" aria-label="Selection result"><strong>{result.complete ? "Selection complete" : "Selection incomplete"}</strong><p>Selected: {result.selected_assets.join(", ") || "none"}</p></section>}
    onHome={onHome} apply={(operation) => void apply(operation)} save={() => void save()} run={() => void run()}
    undo={() => { const target = undoStack.at(-1); if (target) void restore(target, "undo"); }} redo={() => { const target = redoStack.at(-1); if (target) void restore(target, "redo"); }}
    canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} working={working} />;
}
