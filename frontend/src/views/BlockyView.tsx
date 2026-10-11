import { useEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject } from "react";
import * as Blockly from "blockly";

import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { projectBlockyProgram, programStatementForSelection, type BlockyProgram, type ProgramModifier, type ProgramStatement } from "../domain/blockyProgram";
import { constructionOptions, semanticDeleteOperation, type ConstructionOption } from "../domain/builderProjection";
import { sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import { useStrategyEditor } from "../store/editorStore";
import { semanticCompositionApi, type SemanticCompositionProjection } from "../semanticCompositionApi";
import { ChooseTransformationControl, CooldownConstructionControl, FallbackTransformationControl, MetricConstructionControl } from "../components/ShapeTransformationControls";
import { composeRankedSelectionPipeline, insertConditionBeforeRank } from "../domain/compositionIntents";
import { classifyWorkingProgram, controlCommitIntent, hasUnresolvedLogicDraft, logicWorkingProgramSignature, type LogicWorkingProgram } from "../domain/logicDraft";
import type { ConditionExpression } from "../domain/canonical";
import { describeConditionExpression } from "../domain/valueSemantics";
import type { ProgramStatementV2 } from "../domain/canonicalV2";
import { SemanticProgramBlockyProjection } from "../components/SemanticProgramBlockyProjection";
import { registerBlockyProgramBlocks } from "../components/blockyProgramBlocks";
export { registerBlockyProgramBlocks } from "../components/blockyProgramBlocks";

export const blocklyViewportOptions = {
  move: { scrollbars: true, drag: true, wheel: true },
  zoom: { controls: true, wheel: true, startScale: 1, minScale: .45, maxScale: 1.8, scaleSpeed: 1.12 },
} as const;
export const blocklyInjectionOptions = { trashcan: true, sounds: false, maxUndo: 100, ...blocklyViewportOptions } as const;

interface BlockSemanticData {
  workingId: string;
  source: "canonical" | "draft";
  kind: string;
  selection?: SemanticSelection;
  relatedComponentIds?: string[];
  condition?: ConditionExpression | null;
}

export type BlockyClickIntent = { kind: "select"; blockId: string } | { kind: "clear" } | null;
export function blockyClickIntent(event: Pick<Blockly.Events.Abstract, "type"> & { targetType?: string; blockId?: string }): BlockyClickIntent {
  if (event.type !== Blockly.Events.CLICK) return null;
  if (event.targetType === Blockly.Events.ClickTarget.WORKSPACE) return { kind: "clear" };
  if (event.targetType === Blockly.Events.ClickTarget.BLOCK && event.blockId) return { kind: "select", blockId: event.blockId };
  return null;
}

function parseData(block: Blockly.Block): BlockSemanticData | null {
  if (!block.data) return null;
  try { return JSON.parse(block.data) as BlockSemanticData; } catch { return null; }
}
function setData(block: Blockly.Block, value: BlockSemanticData) { block.data = JSON.stringify(value); }

export function projectWorkingProgram(canvas: Blockly.Workspace): LogicWorkingProgram {
  const blocks = canvas.getAllBlocks(false).flatMap((block) => {
    const data = parseData(block);
    if (!data || block.type === "rt_context") return [];
    const parent = block.getParent();
    const parentData = parent ? parseData(parent) : null;
    const input = parent?.inputList.find((item) => item.connection?.targetBlock() === block)?.name
      ?? (parent?.getNextBlock() === block ? "NEXT" : null);
    const next = block.getNextBlock();
    return [{
      workingId: data.workingId,
      blockType: block.type,
      source: data.source,
      componentId: data.selection?.componentId ?? null,
      parentWorkingId: parentData?.workingId ?? null,
      inputName: input,
      nextWorkingId: next ? parseData(next)?.workingId ?? null : null,
      summary: data.source === "draft" ? String(block.getFieldValue("PREDICATE") ?? "") : null,
      condition: data.source === "draft" ? data.condition ?? null : null,
    }];
  });
  return { blocks };
}

function editableNumber(block: Blockly.BlockSvg, field: string, value: number, apply: (value: number) => Promise<boolean>, busy: MutableRefObject<boolean>, rejected: () => void) {
  block.setFieldValue(String(value), field);
  block.getField(field)?.setValidator((input) => {
    const next = Number(input);
    if (!Number.isFinite(next) || busy.current) return null;
    busy.current = true;
    void apply(next).then((ok) => { if (!ok) { block.setFieldValue(String(value), field); rejected(); } })
      .finally(() => { busy.current = false; });
    return null;
  });
}

function connectValue(parent: Blockly.BlockSvg, input: string, child: Blockly.BlockSvg) {
  const connection = parent.getInput(input)?.connection;
  if (connection && child.outputConnection) connection.connect(child.outputConnection);
}

function CanonicalV1BlockyView({ structural, initialProjection = null }: { structural: StructuralAuthoringController; initialProjection?: SemanticCompositionProjection | null }) {
  const { state, dispatch } = useStrategyEditor();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const busy = useRef(false);
  const autoCommitSignature = useRef("");
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const baseline = useRef<LogicWorkingProgram>({ blocks: [] });
  const initializing = useRef(false);
  const snapshotQueued = useRef(false);
  const [projection, setProjection] = useState<SemanticCompositionProjection | null>(initialProjection);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingOption, setPendingOption] = useState<ConstructionOption | null>(null);
  const flow = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const available = useMemo(() => constructionOptions(flow, structural.capabilities, state.editor.selection), [flow, structural.capabilities, state.editor.selection]);
  const program = useMemo<BlockyProgram | null>(() => projection ? projectBlockyProgram(projection) : null, [projection]);
  const selectedStatement = programStatementForSelection(program ?? { contexts: [] }, state.editor.selection);
  const removable = semanticDeleteOperation(state.editor.selection, structural.capabilities);
  const live = useRef({ state, structural, dispatch });
  live.current = { state, structural, dispatch };

  const publishWorkingProgram = (canvas: Blockly.WorkspaceSvg) => {
    if (initializing.current) return;
    const snapshot = projectWorkingProgram(canvas);
    const status = classifyWorkingProgram(snapshot, baseline.current);
    const current = live.current.state.editor.logicDraft;
    if (current.status === status
      && logicWorkingProgramSignature(current.workingProgram ?? { blocks: [] }) === logicWorkingProgramSignature(status === "clean" ? { blocks: [] } : snapshot)) return;
    live.current.dispatch({ type: "set_logic_working_program", program: status === "clean" ? null : snapshot, status });
  };

  useEffect(() => {
    if (initialProjection) { setProjection(initialProjection); return; }
    let active = true;
    setProjection(null); setProjectionError(null);
    semanticCompositionApi.project(state.canonical)
      .then((result) => { if (active) setProjection(result); })
      .catch(() => { if (active) setProjectionError("This Strategy could not be projected as a decision program."); });
    return () => { active = false; };
  }, [state.canonical, initialProjection]);

  useEffect(() => {
    if (!host.current) return;
    registerBlockyProgramBlocks();
    const canvas = Blockly.inject(host.current, blocklyInjectionOptions);
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.workspaceId !== canvas.id || initializing.current) return;
      const click = blockyClickIntent(event as Blockly.Events.Abstract & { targetType?: string; blockId?: string });
      if (click) {
        if (click.kind === "clear") {
          if (live.current.state.editor.selection) live.current.dispatch({ type: "select_semantic", selection: null });
          if (live.current.state.editor.logicDraft.selectedDraftId) live.current.dispatch({ type: "select_logic_draft", draftId: null });
          return;
        }
        const block = canvas.getBlockById(click.blockId);
        if (!block) return;
        const data = parseData(block);
        if (data?.source === "draft") {
          live.current.dispatch({ type: "select_logic_draft", draftId: data.workingId });
        } else if (data?.selection && !sameSemanticSelection(data.selection, live.current.state.editor.selection)) {
          if (live.current.state.editor.logicDraft.selectedDraftId) live.current.dispatch({ type: "select_logic_draft", draftId: null });
          live.current.dispatch({ type: "select_semantic", selection: data.selection });
        }
        return;
      }
      const structuralEventTypes = new Set<string>([Blockly.Events.BLOCK_CREATE, Blockly.Events.BLOCK_DELETE, Blockly.Events.BLOCK_MOVE, Blockly.Events.BLOCK_CHANGE]);
      if (!structuralEventTypes.has(event.type)) return;
      if (!snapshotQueued.current) {
        snapshotQueued.current = true;
        queueMicrotask(() => { snapshotQueued.current = false; publishWorkingProgram(canvas); });
      }
    };
    canvas.addChangeListener(listener);
    return () => { canvas.removeChangeListener(listener); canvas.dispose(); workspace.current = null; };
  }, []);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas || !program) return;
    for (const block of canvas.getTopBlocks(false)) {
      const data = parseData(block);
      const key = data?.workingId;
      if (key) positions.current.set(key, block.getRelativeToSurfaceXY());
    }
    initializing.current = true;
    Blockly.Events.disable();
    try {
      canvas.clear();
      program.contexts.forEach((context, contextIndex) => {
        const contextBlock = canvas.newBlock("rt_context") as Blockly.BlockSvg;
        contextBlock.setFieldValue(context.label, "LABEL");
        setData(contextBlock, { workingId: context.id, source: "canonical", kind: "context", selection: context.selection });
        contextBlock.setDeletable(false); contextBlock.setMovable(true); contextBlock.contextMenu = false;
        contextBlock.initSvg(); contextBlock.render();
        const contextPosition = positions.current.get(context.id);
        contextBlock.moveBy(contextPosition?.x ?? 40 + contextIndex * 360, contextPosition?.y ?? 30);
        context.scripts.forEach((script, scriptIndex) => {
          const trigger = canvas.newBlock("rt_trigger") as Blockly.BlockSvg;
          trigger.setFieldValue(script.triggerLabel.toLowerCase(), "LABEL");
          setData(trigger, { workingId: `trigger:${script.id}`, source: "canonical", kind: "trigger", selection: script.triggerSelection });
          trigger.setDeletable(true); trigger.setMovable(true); trigger.contextMenu = true;
          trigger.initSvg(); trigger.render();
          const triggerPosition = positions.current.get(`trigger:${script.id}`);
          trigger.moveBy(triggerPosition?.x ?? 60 + contextIndex * 360, triggerPosition?.y ?? 85 + scriptIndex * 250);
          let prior = trigger;
          for (const statement of script.statements) {
            const block = createStatementBlock(canvas, statement, structural, busy, () => setNotice("The backend rejected that value. Strategy unchanged."));
            if (prior.nextConnection && block.previousConnection) prior.nextConnection.connect(block.previousConnection);
            prior = block;
          }
        });
      });
      baseline.current = projectWorkingProgram(canvas);
      canvas.clearUndo();
    } finally { Blockly.Events.enable(); initializing.current = false; }
    dispatch({ type: "set_logic_working_program", program: null, status: "clean" });
  }, [program, state.editor.logicDraft.restoreVersion, dispatch]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas || state.editor.logicDraft.pendingControls.length === 0) return;
    for (const request of state.editor.logicDraft.pendingControls) {
      if (canvas.getAllBlocks(false).some((block) => parseData(block)?.workingId === request.draftId)) {
        dispatch({ type: "ack_logic_control", draftId: request.draftId });
        continue;
      }
      const block = canvas.newBlock(request.kind === "if" ? "rt_draft_if" : "rt_draft_if_else") as Blockly.BlockSvg;
      setData(block, { workingId: request.draftId, source: "draft", kind: request.kind, condition: null });
      block.setDeletable(true); block.setMovable(true); block.contextMenu = true;
      block.initSvg(); block.render();
      const metrics = canvas.getMetrics();
      block.moveBy(request.position?.x ?? (metrics?.viewLeft ?? 0) + 70, request.position?.y ?? (metrics?.viewTop ?? 0) + 70);
      block.select();
      dispatch({ type: "ack_logic_control", draftId: request.draftId });
    }
    queueMicrotask(() => publishWorkingProgram(canvas));
  }, [state.editor.logicDraft.pendingControls, dispatch]);

  useEffect(() => {
    const canvas = workspace.current;
    const program = state.editor.logicDraft.workingProgram;
    if (!canvas || !program) return;
    let changed = false;
    for (const item of program.blocks.filter((block) => block.source === "draft")) {
      const block = canvas.getAllBlocks(false).find((candidate) => parseData(candidate)?.workingId === item.workingId);
      if (!block) continue;
      const data = parseData(block);
      if (!data || JSON.stringify(data.condition ?? null) === JSON.stringify(item.condition ?? null)) continue;
      setData(block, { ...data, condition: item.condition });
      block.setFieldValue(item.condition ? describeConditionExpression(item.condition) : "[set condition]", "PREDICATE");
      changed = true;
    }
    if (changed) queueMicrotask(() => publishWorkingProgram(canvas));
  }, [state.editor.logicDraft.workingProgram]);

  useEffect(() => {
    const canvas = workspace.current;
    const request = state.editor.logicDraft.removalRequestId;
    if (!canvas || !request) return;
    const block = canvas.getAllBlocks(false).find((item) => parseData(item)?.workingId === request);
    block?.dispose(true);
    dispatch({ type: "ack_remove_logic_draft" });
    queueMicrotask(() => publishWorkingProgram(canvas));
  }, [state.editor.logicDraft.removalRequestId, dispatch]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas || state.editor.activeView !== "blocky") return;
    Blockly.svgResize(canvas);
    const selectedComponentId = state.editor.selection?.componentId;
    if (!selectedComponentId) return;
    const block = canvas.getAllBlocks(false).find((item) => {
      const data = parseData(item);
      return data?.selection?.componentId === selectedComponentId || data?.relatedComponentIds?.includes(selectedComponentId);
    });
    block?.select();
  }, [state.editor.activeView, state.editor.selection, selectedStatement, program]);

  const acceptConstruction = (option: ConstructionOption) => {
    dispatch({ type: "select_semantic", selection: option.anchorSelection });
    if (option.kind !== "qualification") { setPendingOption(option); return; }
    const operation = insertConditionBeforeRank(state.canonical, option.targetComponentId);
    if (!operation || busy.current) return;
    busy.current = true;
    void structural.compose(operation, (result) => semanticSelection("qualification", result.created_component_ids.condition ?? null, { fieldPath: "config.threshold", groupId: option.groupId }))
      .then((ok) => { if (!ok) setNotice("The backend rejected that concept. Strategy unchanged."); else setNotice(null); })
      .finally(() => { busy.current = false; });
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const control = event.dataTransfer.getData("application/x-ruletrade-blocky-control");
    if (control) {
      try {
        const intent = JSON.parse(control) as { kind: "if" | "if_otherwise" };
        const canvas = workspace.current;
        const position = canvas
          ? Blockly.utils.svgMath.screenToWsCoordinates(canvas, new Blockly.utils.Coordinate(event.clientX, event.clientY))
          : undefined;
        dispatch({ type: "request_logic_control", kind: intent.kind, position });
      } catch { /* Ignore malformed RuleTrade control drops. */ }
      return;
    }
    try {
      const intent = JSON.parse(event.dataTransfer.getData("application/x-ruletrade-concept")) as { kind: string; targetComponentId: string };
      const option = available.find((item) => item.kind === intent.kind && item.targetComponentId === intent.targetComponentId);
      if (option) acceptConstruction(option);
    } catch { /* Ignore non-RuleTrade drops. */ }
  };
  const finishPending = async (operation: Parameters<typeof structural.apply>[0], selection: SemanticSelection) => {
    const ok = await structural.apply(operation, selection);
    if (ok) setPendingOption(null);
    return ok;
  };
  useEffect(() => {
    const program = state.editor.logicDraft.workingProgram;
    if (state.editor.logicDraft.status !== "commit_ready" || !program || busy.current) return;
    const signature = logicWorkingProgramSignature(program);
    if (autoCommitSignature.current === signature) return;
    const intent = controlCommitIntent(program);
    if (!intent) return;
    autoCommitSignature.current = signature;
    busy.current = true;
    setNotice("Applying complete Control…");
    void structural.apply({ kind: "commit_predicate_branches", ...intent }, semanticSelection("rule", intent.component_id, { fieldPath: "condition" }))
      .then((ok) => {
        if (ok) {
          setNotice(null);
          dispatch({ type: "restore_logic_program" });
        } else setNotice("The complete Control could not be applied. Your draft is preserved.");
      })
      .finally(() => { busy.current = false; });
  }, [state.editor.logicDraft.status, state.editor.logicDraft.workingProgram, structural, dispatch]);


  return <div className="blocky-representation" data-program-composer onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-ruletrade-concept") || event.dataTransfer.types.includes("application/x-ruletrade-blocky-control")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={onDrop}>
    {!projection && !projectionError && <p className="blocky-loading" role="status">Building decision program…</p>}
    {projectionError && <p className="blocky-loading" role="alert">{projectionError}</p>}
    <div className="blocky-canvas" ref={host} hidden={!projection} aria-label="Strategy decision program" />
    {hasUnresolvedLogicDraft(state.editor.logicDraft) && <div className="blocky-draft-indicator" data-workspace-status="overlay" role="status"><span>{state.editor.logicDraft.status === "commit_ready" ? "Complete Control · applying automatically" : "Unfinished Blocky changes · Save/Test disabled"}</span><button className="text-button" onClick={() => dispatch({ type: "restore_logic_program" })}>Discard changes</button></div>}
    {(pendingOption || removable) && <div className="blocky-actions" aria-label="Contextual block actions">
      {pendingOption?.kind === "metric" && <MetricConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={async (lookback, count) => { const operation = composeRankedSelectionPipeline(state.canonical, pendingOption.targetComponentId, lookback, count); if (!operation) return false; const ok = await structural.compose(operation, (result) => semanticSelection("rule", result.created_component_ids.metric ?? null, { fieldPath: "config.lookback_bars", groupId: pendingOption.groupId })); if (ok) setPendingOption(null); return ok; }} />}
      {pendingOption?.kind === "choose" && <ChooseTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => finishPending({ kind: "transform_to_choose_assets", weight_component_id: pendingOption.targetComponentId, lookback_observations: lookback, count }, semanticSelection("selection", `${pendingOption.targetComponentId}_top_n`, { groupId: pendingOption.groupId }))} />}
      {pendingOption?.kind === "fallback" && <FallbackTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(asset) => finishPending({ kind: "add_fallback_selection", weight_component_id: pendingOption.targetComponentId, fallback_asset: asset }, semanticSelection("fallback", `${pendingOption.targetComponentId}_fallback`, { groupId: pendingOption.groupId }))} />}
      {pendingOption?.kind === "cooldown" && <CooldownConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(duration) => finishPending({ kind: "add_cooldown_to_selection", selection_component_id: pendingOption.targetComponentId, duration }, semanticSelection("cooldown", `${pendingOption.targetComponentId}_cooldown`, { fieldPath: "config.duration", groupId: pendingOption.groupId }))} />}
      {removable && <button className="text-button danger" disabled={structural.status === "applying"} onClick={() => void structural.apply(removable, null)}>Remove selected {selectedStatement?.kind ?? "concept"}</button>}
      {pendingOption && <button className="text-button" onClick={() => setPendingOption(null)}>Cancel</button>}
    </div>}
    {(notice || structural.error) && <p role="alert" className="structural-error blocky-notice">{notice ?? structural.error?.message}</p>}
  </div>;
}

export type SemanticProgramBlockyProps = {
  statements: ProgramStatementV2[];
  contextLabel?: string;
  scheduleLabel?: string;
  selectedId: string | null;
  onSelect: (semanticId: string | null) => void;
};

/** The production Blocky entry point shared by both semantic backends. */
export function BlockyView(props: ({ structural: StructuralAuthoringController; initialProjection?: SemanticCompositionProjection | null }) | { semanticProgram: SemanticProgramBlockyProps }) {
  if ("semanticProgram" in props) return <SemanticProgramBlockyProjection {...props.semanticProgram} />;
  return <CanonicalV1BlockyView {...props} />;
}

function createModifierBlock(canvas: Blockly.WorkspaceSvg, modifier: ProgramModifier, structural: StructuralAuthoringController, busy: MutableRefObject<boolean>, rejected: () => void): Blockly.BlockSvg {
  const type = modifier.kind === "eligibility" ? "rt_eligibility" : modifier.kind === "constraint" ? "rt_constraint" : "rt_fallback";
  const block = canvas.newBlock(type) as Blockly.BlockSvg;
  setData(block, { workingId: `modifier:${modifier.kind}:${modifier.selection.componentId ?? modifier.ref.primary_component_id}`, source: "canonical", kind: modifier.kind, selection: modifier.selection, relatedComponentIds: modifier.ref.related_component_ids });
  block.setDeletable(true); block.setMovable(true); block.contextMenu = true;
  if (modifier.kind === "eligibility" || modifier.kind === "fallback") block.setFieldValue(modifier.label, "LABEL");
  else if (modifier.value !== undefined) editableNumber(block, "VALUE", modifier.value, async (next) => {
    const id = modifier.selection.componentId;
    if (!id) return false;
    return modifier.kind === "eligibility"
      ? structural.apply({ kind: "update_qualification_threshold", component_id: id, threshold: String(next) }, modifier.selection)
      : structural.apply({ kind: "update_cooldown_duration", component_id: id, duration: next }, modifier.selection);
  }, busy, rejected);
  block.initSvg(); block.render();
  return block;
}

function createStatementBlock(canvas: Blockly.WorkspaceSvg, statement: ProgramStatement, structural: StructuralAuthoringController, busy: MutableRefObject<boolean>, rejected: () => void): Blockly.BlockSvg {
  const type = statement.kind === "selection"
    ? statement.label.toLowerCase().includes("random") ? "rt_random_selection" : "rt_selection"
    : statement.kind === "allocation" ? "rt_allocation" : statement.kind === "control" ? "rt_control" : "rt_action";
  const block = canvas.newBlock(type) as Blockly.BlockSvg;
  setData(block, { workingId: statement.id, source: "canonical", kind: statement.kind, selection: statement.selection, relatedComponentIds: statement.ref.related_component_ids });
  block.setDeletable(true); block.setMovable(true); block.contextMenu = true;
  if (statement.kind !== "control") block.setFieldValue(statement.label, "LABEL");
  block.initSvg(); block.render();
  for (const modifier of statement.modifiers) {
    const child = createModifierBlock(canvas, modifier, structural, busy, rejected);
    if (modifier.kind === "eligibility") connectValue(block, "ELIGIBILITY", child);
    else if (modifier.kind === "constraint") connectValue(block, "CONSTRAINT", child);
    else connectValue(block, "FALLBACK", child);
  }
  if (statement.kind === "control") {
    block.setFieldValue(statement.label, "LABEL");
    connectStatementChain(canvas, block, "THEN", statement.thenStatements, structural, busy, rejected);
    connectStatementChain(canvas, block, "ELSE", statement.elseStatements, structural, busy, rejected);
  }
  return block;
}

function connectStatementChain(canvas: Blockly.WorkspaceSvg, parent: Blockly.BlockSvg, inputName: string, statements: ProgramStatement[], structural: StructuralAuthoringController, busy: MutableRefObject<boolean>, rejected: () => void) {
  let connection = parent.getInput(inputName)?.connection ?? null;
  for (const statement of statements) {
    const child = createStatementBlock(canvas, statement, structural, busy, rejected);
    if (connection && child.previousConnection) connection.connect(child.previousConnection);
    connection = child.nextConnection;
  }
}
