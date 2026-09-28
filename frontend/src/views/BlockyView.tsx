import { useEffect, useMemo, useRef, useState } from "react";
import * as Blockly from "blockly";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { projectLogicRepresentation, logicStepForSelection, type LogicStep } from "../domain/logicRepresentation";
import { constructionOptions, semanticDeleteOperation, type ConstructionOption } from "../domain/builderProjection";
import { blockFieldOperation } from "../domain/blockyAuthoring";
import { sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import { useStrategyEditor } from "../store/editorStore";
import { ChooseTransformationControl, CooldownConstructionControl, FallbackTransformationControl, GrowthDefensiveTransformationControl } from "../components/ShapeTransformationControls";
import { composeTwoSleevePortfolio, insertConditionBeforeRank } from "../domain/compositionIntents";

export const blocklyViewportOptions = {
  move: { scrollbars: true, drag: true, wheel: true },
  zoom: { controls: true, wheel: true, startScale: 1, minScale: .45, maxScale: 1.8, scaleSpeed: 1.12 },
} as const;

const blockTypes: Record<LogicStep["kind"], string> = {
  group: "rt_group", assets: "rt_assets", score: "rt_score", condition: "rt_condition", rank: "rt_rank",
  choose: "rt_choose", cooldown: "rt_cooldown", fallback: "rt_fallback", schedule: "rt_schedule",
};
let registered = false;
function registerBlocks() {
  if (registered) return;
  registered = true;
  Blockly.defineBlocksWithJsonArray([
    ...Object.entries(blockTypes).map(([kind, type]) => ({
      type, message0: kind === "group" ? "%1" : kind === "condition" ? "Return above %1 %%" : ["score", "choose", "cooldown"].includes(kind) ? `${kind} · %1` : "%1",
      args0: [{ type: ["score", "condition", "choose", "cooldown"].includes(kind) ? "field_number" : "field_label_serializable", name: "value", value: 1, text: "" }],
      previousStatement: kind === "group" ? undefined : null, nextStatement: null,
      colour: kind === "condition" ? 155 : kind === "cooldown" ? 35 : kind === "group" ? 255 : 210,
    })),
  ]);
}

const constructionType = (option: ConstructionOption) => `rt_construct_${option.kind}_${option.targetComponentId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
function ensureConstructionBlock(option: ConstructionOption) {
  const type = constructionType(option);
  if (!Blockly.Blocks[type]) Blockly.Blocks[type] = { init() { this.appendDummyInput().appendField(`${option.label} → ${option.targetLabel}`); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(option.kind === "qualification" ? 155 : option.kind === "cooldown" ? 35 : 210); this.setTooltip(option.description); } };
  return type;
}

export function BlockyView({ structural }: { structural: StructuralAuthoringController }) {
  const { state, dispatch } = useStrategyEditor();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const busy = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingOption, setPendingOption] = useState<ConstructionOption | null>(null);
  const logic = useMemo(() => projectLogicRepresentation(state.canonical, state.registry), [state.canonical, state.registry]);
  const flow = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const cap = structural.capabilities;
  const available = useMemo(() => constructionOptions(flow, cap, state.editor.selection), [flow, cap, state.editor.selection]);
  const selectedStep = logicStepForSelection(logic, state.editor.selection);
  const removable = semanticDeleteOperation(state.editor.selection, cap);
  const live = useRef({ canonical: state.canonical, logic, cap, selection: state.editor.selection, available, structural, dispatch });
  live.current = { canonical: state.canonical, logic, cap, selection: state.editor.selection, available, structural, dispatch };

  useEffect(() => {
    if (!host.current) return;
    registerBlocks();
    const canvas = Blockly.inject(host.current, { toolbox: { kind: "flyoutToolbox", contents: [] }, trashcan: false,
      sounds: false, ...blocklyViewportOptions });
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.workspaceId !== canvas.id) return;
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        const created = event as Blockly.Events.BlockCreate;
        const block = created.ids?.map((id) => canvas.getBlockById(id)).find((item) => item?.type.startsWith("rt_construct_"));
        const current = live.current;
        const option = current.available.find((item) => block?.type === constructionType(item));
        if (!block || !option || busy.current) return;
        block.dispose(false);
        current.dispatch({ type: "select_semantic", selection: option.anchorSelection });
        if (option.kind !== "qualification") { setPendingOption(option); return; }
        const operation = insertConditionBeforeRank(current.canonical, option.targetComponentId);
        if (!operation) return;
        busy.current = true;
        void current.structural.compose(operation,
          (result) => semanticSelection("qualification", result.created_component_ids.condition ?? null, { fieldPath: "config.threshold", groupId: option.groupId }))
          .then((ok) => { if (!ok) setNotice("The backend rejected that block. Strategy unchanged."); else setNotice(null); })
          .finally(() => { busy.current = false; });
      }
      if (event.type === Blockly.Events.SELECTED) {
        const block = Blockly.common.getSelected();
        if (!(block instanceof Blockly.Block) || block.workspace !== canvas || !block.data) { if (live.current.selection) live.current.dispatch({ type: "select_semantic", selection: null }); return; }
        const selection = JSON.parse(block.data) as SemanticSelection;
        const current = live.current;
        if (!sameSemanticSelection(selection, current.selection)) current.dispatch({ type: "select_semantic", selection });
      }
    };
    canvas.addChangeListener(listener);
    return () => { canvas.removeChangeListener(listener); canvas.dispose(); workspace.current = null; };
  }, []);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas) return;
    Blockly.Events.disable();
    try {
      canvas.clear();
      if (logic.unsupportedReason) return;
      logic.groups.forEach((group, groupIndex) => {
        let prior: Blockly.BlockSvg | undefined;
        group.steps.forEach((step) => {
          const block = canvas.newBlock(blockTypes[step.kind]) as Blockly.BlockSvg;
          block.data = JSON.stringify(step.selection);
          // Move a projected logic stack as presentation state; internal order remains Canonical-owned.
          block.setDeletable(false); block.setMovable(step.kind === "group"); block.contextMenu = false;
          if (step.value !== undefined) {
            block.setFieldValue(String(step.value), "value");
            block.getField("value")?.setValidator((input) => {
              const current = live.current;
              const op = blockFieldOperation(step, Number(input), current.cap);
              if (op && !busy.current) {
                busy.current = true;
                void current.structural.apply(op, step.selection).then((ok) => {
                  if (!ok) { block.setFieldValue(String(step.value), "value"); setNotice("The backend rejected that value. Strategy unchanged."); }
                  else setNotice(null);
                }).finally(() => { busy.current = false; });
              }
              return null; // editor cannot accept semantic state before backend apply
            });
          } else block.setFieldValue(step.text, "value");
          block.initSvg(); block.render();
          if (prior?.nextConnection && block.previousConnection) prior.nextConnection.connect(block.previousConnection);
          else block.moveBy(40 + groupIndex * 310, 35);
          prior = block;
        });
      });
    } finally { Blockly.Events.enable(); }
  }, [logic]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas || state.editor.activeView !== "blocky") return;
    Blockly.svgResize(canvas);
    if (!selectedStep) return;
    const block = canvas.getAllBlocks(false).find((item) => item.data && (JSON.parse(item.data) as SemanticSelection).componentId === selectedStep.selection.componentId);
    block?.select();
  }, [state.editor.activeView, selectedStep, logic]);

  useEffect(() => {
    available.forEach(ensureConstructionBlock);
    workspace.current?.updateToolbox({ kind: "flyoutToolbox", contents: available.map((option) => ({ kind: "block", type: constructionType(option) })) });
  }, [available]);

  const finishPending = async (operation: Parameters<typeof structural.apply>[0], selection: SemanticSelection) => { const ok = await structural.apply(operation, selection); if (ok) setPendingOption(null); return ok; };
  return <div className="blocky-representation">
    {logic.unsupportedReason && <p role="status">This Strategy cannot yet be shown as logic blocks: {logic.unsupportedReason}</p>}
    <div className="blocky-canvas" ref={host} hidden={Boolean(logic.unsupportedReason)} aria-label="Strategy logic blocks" />
    <div className="blocky-actions">
      {pendingOption?.kind === "choose" && <ChooseTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => finishPending({ kind: "transform_to_choose_assets", weight_component_id: pendingOption.targetComponentId, lookback_observations: lookback, count }, semanticSelection("selection", `${pendingOption.targetComponentId}_top_n`, { groupId: pendingOption.groupId }))} />}
      {pendingOption?.kind === "fallback" && <FallbackTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(asset) => finishPending({ kind: "add_fallback_selection", weight_component_id: pendingOption.targetComponentId, fallback_asset: asset }, semanticSelection("fallback", `${pendingOption.targetComponentId}_fallback`, { groupId: pendingOption.groupId }))} />}
      {pendingOption?.kind === "cooldown" && <CooldownConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(duration) => finishPending({ kind: "add_cooldown_to_selection", selection_component_id: pendingOption.targetComponentId, duration }, semanticSelection("cooldown", `${pendingOption.targetComponentId}_cooldown`, { fieldPath: "config.duration", groupId: pendingOption.groupId }))} />}
      {pendingOption?.kind === "split" && <GrowthDefensiveTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={async (allocation, assets) => {
        const operation = composeTwoSleevePortfolio(state.canonical, pendingOption.targetComponentId, allocation, assets);
        if (!operation) return false;
        const ok = await structural.compose(operation, (result) => semanticSelection("split", result.created_component_ids.portfolio ?? null));
        if (ok) setPendingOption(null);
        return ok;
      }} />}
      {removable && <button className="text-button danger" disabled={structural.status === "applying"} onClick={() => void structural.apply(removable, null)}>Remove selected {selectedStep?.kind ?? "concept"}</button>}
    </div>{(notice || structural.error) && <p role="alert" className="structural-error">{notice ?? structural.error?.message}</p>}
  </div>;
}
