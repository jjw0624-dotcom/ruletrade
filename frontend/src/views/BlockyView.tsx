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

export const blocklyViewportOptions = {
  move: { scrollbars: true, drag: true, wheel: true },
  zoom: { controls: true, wheel: true, startScale: 1, minScale: .45, maxScale: 1.8, scaleSpeed: 1.12 },
} as const;
export const blocklyInjectionOptions = { trashcan: false, sounds: false, ...blocklyViewportOptions } as const;

interface BlockSemanticData {
  selection?: SemanticSelection;
  relatedComponentIds?: string[];
  draftId?: string;
}

let registered = false;
function registerBlocks() {
  if (registered) return;
  registered = true;
  Blockly.defineBlocksWithJsonArray([
    { type: "rt_context", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Context" }], colour: 255 },
    { type: "rt_trigger", message0: "Every %1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "month" }], nextStatement: null, colour: 285 },
    { type: "rt_selection", message0: "Choose %1 strongest assets", args0: [{ type: "field_number", name: "COUNT", value: 1, min: 1, precision: 1 }], message1: "%1", args1: [{ type: "input_value", name: "ELIGIBILITY", check: "RuleTradeEligibility" }], message2: "%1", args2: [{ type: "input_value", name: "CONSTRAINT", check: "RuleTradeConstraint" }], message3: "if selection is incomplete %1", args3: [{ type: "input_statement", name: "FALLBACK", check: "RuleTradeFallback" }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_random_selection", message0: "Choose %1 assets", args0: [{ type: "field_number", name: "COUNT", value: 1, min: 1, precision: 1 }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_eligibility", message0: "eligible when return > %1 %%", args0: [{ type: "field_number", name: "VALUE", value: 0 }], output: "RuleTradeEligibility", colour: 155 },
    { type: "rt_constraint", message0: "Cooldown %1 trading days", args0: [{ type: "field_number", name: "VALUE", value: 1, min: 1, precision: 1 }], output: "RuleTradeConstraint", colour: 35 },
    { type: "rt_fallback", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocate to fallback" }], previousStatement: "RuleTradeFallback", nextStatement: "RuleTradeFallback", colour: 65 },
    { type: "rt_allocation", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocate capital" }], previousStatement: null, nextStatement: null, colour: 120 },
    { type: "rt_action", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Rebalance" }], previousStatement: null, nextStatement: null, colour: 20 },
    { type: "rt_control", message0: "IF %1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "condition" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], message2: "OTHERWISE %1", args2: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 300 },
    { type: "rt_draft_if", message0: "DRAFT IF %1", args0: [{ type: "field_input", name: "PREDICATE", text: "describe predicate" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], message2: "OTHERWISE %1", args2: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 330 },
  ]);
}

function parseData(block: Blockly.Block): BlockSemanticData | null {
  if (!block.data) return null;
  try { return JSON.parse(block.data) as BlockSemanticData; } catch { return null; }
}
function setData(block: Blockly.Block, value: BlockSemanticData) { block.data = JSON.stringify(value); }

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

export function BlockyView({ structural, initialProjection = null }: { structural: StructuralAuthoringController; initialProjection?: SemanticCompositionProjection | null }) {
  const { state, dispatch } = useStrategyEditor();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const busy = useRef(false);
  const positions = useRef(new Map<string, { x: number; y: number }>());
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
    registerBlocks();
    const canvas = Blockly.inject(host.current, blocklyInjectionOptions);
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.workspaceId !== canvas.id || event.type !== Blockly.Events.SELECTED) return;
      const block = Blockly.common.getSelected();
      if (!(block instanceof Blockly.Block) || block.workspace !== canvas) {
        if (live.current.state.editor.selection) live.current.dispatch({ type: "select_semantic", selection: null });
        return;
      }
      const data = parseData(block);
      if (data?.selection && !sameSemanticSelection(data.selection, live.current.state.editor.selection)) live.current.dispatch({ type: "select_semantic", selection: data.selection });
    };
    canvas.addChangeListener(listener);
    return () => { canvas.removeChangeListener(listener); canvas.dispose(); workspace.current = null; };
  }, []);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas || !program) return;
    for (const block of canvas.getTopBlocks(false)) {
      const data = parseData(block);
      const key = data?.draftId ?? data?.selection?.componentId;
      if (key) positions.current.set(key, block.getRelativeToSurfaceXY());
    }
    Blockly.Events.disable();
    try {
      canvas.clear();
      program.contexts.forEach((context, contextIndex) => {
        const contextBlock = canvas.newBlock("rt_context") as Blockly.BlockSvg;
        contextBlock.setFieldValue(`${context.label} · ${context.kind}`, "LABEL");
        setData(contextBlock, { selection: context.selection });
        contextBlock.setDeletable(false); contextBlock.setMovable(true); contextBlock.contextMenu = false;
        contextBlock.initSvg(); contextBlock.render();
        const contextPosition = positions.current.get(context.selection.componentId ?? context.id);
        contextBlock.moveBy(contextPosition?.x ?? 40 + contextIndex * 360, contextPosition?.y ?? 30);
        context.scripts.forEach((script, scriptIndex) => {
          const trigger = canvas.newBlock("rt_trigger") as Blockly.BlockSvg;
          trigger.setFieldValue(script.triggerLabel.toLowerCase(), "LABEL");
          setData(trigger, { selection: script.triggerSelection });
          trigger.setDeletable(false); trigger.setMovable(true); trigger.contextMenu = false;
          trigger.initSvg(); trigger.render();
          const triggerPosition = positions.current.get(script.triggerSelection.componentId ?? script.id);
          trigger.moveBy(triggerPosition?.x ?? 60 + contextIndex * 360, triggerPosition?.y ?? 85 + scriptIndex * 250);
          let prior = trigger;
          for (const statement of script.statements) {
            const block = createStatementBlock(canvas, statement, structural, busy, () => setNotice("The backend rejected that value. Strategy unchanged."));
            if (prior.nextConnection && block.previousConnection) prior.nextConnection.connect(block.previousConnection);
            prior = block;
          }
        });
      });
      state.editor.logicDraft.controls.forEach((draft, index) => {
        const block = canvas.newBlock("rt_draft_if") as Blockly.BlockSvg;
        block.setFieldValue(draft.predicateSummary || "describe predicate", "PREDICATE");
        setData(block, { draftId: draft.draftId });
        block.setDeletable(false); block.setMovable(true); block.contextMenu = false;
        block.getField("PREDICATE")?.setValidator((value) => {
          live.current.dispatch({ type: "update_logic_if_draft", draftId: draft.draftId, predicateSummary: String(value) });
          return value;
        });
        block.initSvg(); block.render();
        const point = positions.current.get(draft.draftId);
        block.moveBy(point?.x ?? 80 + index * 40, point?.y ?? 380 + index * 35);
      });
    } finally { Blockly.Events.enable(); }
  }, [program, state.editor.logicDraft.controls]);

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

  return <div className="blocky-representation" data-program-composer onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-ruletrade-concept")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={onDrop}>
    {!projection && !projectionError && <p className="blocky-loading" role="status">Building decision program…</p>}
    {projectionError && <p className="blocky-loading" role="alert">{projectionError}</p>}
    <div className="blocky-canvas" ref={host} hidden={!projection} aria-label="Strategy decision program" />
    {state.editor.logicDraft.controls.length > 0 && <aside className="logic-draft-status" aria-label="Unfinished Blocky edits"><strong>Draft logic</strong><span>Not part of the Strategy yet.</span>{state.editor.logicDraft.controls.map((draft) => <button key={draft.draftId} className="text-button danger" onClick={() => dispatch({ type: "discard_logic_draft", draftId: draft.draftId })}>Discard {draft.draftId}</button>)}</aside>}
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

function createModifierBlock(canvas: Blockly.WorkspaceSvg, modifier: ProgramModifier, structural: StructuralAuthoringController, busy: MutableRefObject<boolean>, rejected: () => void): Blockly.BlockSvg {
  const type = modifier.kind === "eligibility" ? "rt_eligibility" : modifier.kind === "constraint" ? "rt_constraint" : "rt_fallback";
  const block = canvas.newBlock(type) as Blockly.BlockSvg;
  setData(block, { selection: modifier.selection, relatedComponentIds: modifier.ref.related_component_ids });
  block.setDeletable(false); block.setMovable(false); block.contextMenu = false;
  if (modifier.kind === "fallback") block.setFieldValue(modifier.label, "LABEL");
  else if (modifier.value !== undefined) editableNumber(block, "VALUE", modifier.kind === "eligibility" ? modifier.value * 100 : modifier.value, async (next) => {
    const id = modifier.selection.componentId;
    if (!id) return false;
    return modifier.kind === "eligibility"
      ? structural.apply({ kind: "update_qualification_threshold", component_id: id, threshold: String(next / 100) }, modifier.selection)
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
  setData(block, { selection: statement.selection, relatedComponentIds: statement.ref.related_component_ids });
  block.setDeletable(false); block.setMovable(false); block.contextMenu = false;
  if (statement.kind === "selection" && statement.count !== undefined) editableNumber(block, "COUNT", statement.count, async (count) => {
    const id = statement.selection.componentId;
    return id ? structural.apply({ kind: "update_selection_count", component_id: id, count }, statement.selection) : false;
  }, busy, rejected);
  else if (statement.kind !== "control") block.setFieldValue(statement.label, "LABEL");
  block.initSvg(); block.render();
  for (const modifier of statement.modifiers) {
    const child = createModifierBlock(canvas, modifier, structural, busy, rejected);
    if (modifier.kind === "eligibility") connectValue(block, "ELIGIBILITY", child);
    else if (modifier.kind === "constraint") connectValue(block, "CONSTRAINT", child);
    else if (block.getInput("FALLBACK")?.connection && child.previousConnection) block.getInput("FALLBACK")!.connection!.connect(child.previousConnection);
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
