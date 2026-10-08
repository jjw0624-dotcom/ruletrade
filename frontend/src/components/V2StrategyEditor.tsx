import { useEffect, useRef, useState } from "react";
import type { V2AuthoringOperation } from "../domain/canonicalV2";
import type { StrategyDetailV2 } from "../strategyApi";
import { strategyApi } from "../strategyApi";
import { v2AuthoringApi, v2AuthoringErrorMessage } from "../v2AuthoringApi";
import { executeV2Lean, executeV2Selection, v2ExecutionCapability, type V2ExecutionCapability, type V2SelectionExecution } from "../v2ExecutionApi";
import { DEFAULT_BACKTEST_CONFIG, type LeanBacktestResponse } from "../domain/backtest";
import { SemanticProgramBuilderAdapter } from "./SemanticProgramBuilderAdapter";
import { CompatibilitySelectionBuilderAdapter } from "./CompatibilitySelectionBuilderAdapter";

export function V2StrategyEditor({ persisted, onHome, onDirtyChange }: {
  persisted: StrategyDetailV2;
  onHome: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initial = persisted.current_revision.canonical_strategy;
  const [canonical, setCanonical] = useState(initial);
  const [revisionId, setRevisionId] = useState(persisted.current_revision.id);
  const [sourceHash, setSourceHash] = useState(persisted.current_revision.source_hash);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"saved" | "updating" | "invalid" | "unfinished">("saved");
  const [message, setMessage] = useState("Saved");
  const [result, setResult] = useState<V2SelectionExecution | LeanBacktestResponse | null>(null);
  const [executionCapability, setExecutionCapability] = useState<V2ExecutionCapability | null>(null);
  const [undoStack, setUndoStack] = useState<typeof initial[]>([]);
  const [redoStack, setRedoStack] = useState<typeof initial[]>([]);
  const sequence = useRef(0);
  const unavailable = status === "unfinished" || status === "invalid" || status === "updating";
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    let active = true;
    void v2ExecutionCapability(canonical).then((value) => { if (active) setExecutionCapability(value); }).catch(() => {
      if (active) setExecutionCapability({ authorable: true, reference_valid: true, backend_lowerable: false, production_executable: false, reason: "Execution capability could not be checked." });
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
  const save = async () => {
    if (!dirty || status !== "saved") return;
    setStatus("updating"); setMessage("Saving revision…");
    try {
      const response = await strategyApi.save(persisted.strategy.id, revisionId, canonical);
      setCanonical(response.revision.canonical_strategy);
      setRevisionId(response.revision.id);
      setSourceHash(response.revision.source_hash);
      setDirty(false); setStatus("saved"); setMessage("Saved");
    } catch (reason) {
      setStatus("invalid"); setMessage(reason instanceof Error ? reason.message : "Save failed.");
    }
  };
  const run = async () => {
    if (unavailable) return;
    setStatus("updating"); setMessage("Testing committed strategy…");
    try {
      const next = canonical.program
        ? await executeV2Lean(canonical, { ...DEFAULT_BACKTEST_CONFIG, dataset_id: "filter-synthetic" })
        : await executeV2Selection(canonical);
      setResult(next); setStatus("saved"); setMessage("Test complete");
    } catch (reason) {
      setStatus("invalid"); setMessage(reason instanceof Error ? reason.message : "Test failed.");
    }
  };
  const working = (unfinished: boolean) => {
    setStatus(unfinished ? "unfinished" : "saved");
    setMessage(unfinished ? "Unfinished semantic edit" : "Ready");
  };
  if (canonical.selection === null && canonical.program) {
    return <SemanticProgramBuilderAdapter canonical={canonical} dirty={dirty} status={status} message={message} onHome={onHome}
      apply={(operation) => void apply(operation)} save={() => void save()}
      undo={() => { const target = undoStack.at(-1); if (target) void restore(target, "undo"); }}
      redo={() => { const target = redoStack.at(-1); if (target) void restore(target, "redo"); }}
      canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} working={working}
      run={() => void run()} executionCapability={executionCapability} />;
  }
  if (canonical.selection === null) return null;
  return <CompatibilitySelectionBuilderAdapter canonical={canonical as typeof canonical & { selection: NonNullable<typeof canonical.selection> }} dirty={dirty} status={status} message={message}
    result={result && "selected_assets" in result && <section className="v2-test-result" aria-label="Selection result"><strong>{result.complete ? "Selection complete" : "Selection incomplete"}</strong><p>Selected: {result.selected_assets.join(", ") || "none"}</p></section>}
    onHome={onHome} apply={(operation) => void apply(operation)} save={() => void save()} run={() => void run()}
    undo={() => { const target = undoStack.at(-1); if (target) void restore(target, "undo"); }} redo={() => { const target = redoStack.at(-1); if (target) void restore(target, "redo"); }}
    canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} working={working} />;
}
