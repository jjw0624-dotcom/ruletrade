import { useEffect, useMemo, useRef, useState } from "react";
import * as Blockly from "blockly";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { projectLogicRepresentation, logicStepForSelection, type LogicStep } from "../domain/logicRepresentation";
import { semanticDeleteOperation } from "../domain/builderProjection";
import { blockFieldOperation, qualificationDropOperation } from "../domain/blockyAuthoring";
import { sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import { useStrategyEditor } from "../store/editorStore";
import { ChooseTransformationControl, CooldownConstructionControl, FallbackTransformationControl } from "../components/ShapeTransformationControls";

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
    { type: "rt_add_condition", message0: "Add qualification", previousStatement: null, nextStatement: null, colour: 155 },
  ]);
}

export function BlockyView({ structural }: { structural: StructuralAuthoringController }) {
  const { state, dispatch } = useStrategyEditor();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const busy = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const logic = useMemo(() => projectLogicRepresentation(state.canonical, state.registry), [state.canonical, state.registry]);
  const flow = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const contextGroup = flow.groups.find((group) => group.id === state.editor.selection?.groupId) ?? (flow.groups.length === 1 ? flow.groups[0] : undefined);
  const choose = contextGroup?.choose;
  const cap = structural.capabilities;
  const rankId = choose?.rankComponentId;
  const canCondition = Boolean(qualificationDropOperation(rankId, cap));
  const selectedStep = logicStepForSelection(logic, state.editor.selection);
  const removable = semanticDeleteOperation(state.editor.selection, cap);
  const live = useRef({ logic, cap, selection: state.editor.selection, rankId, structural, dispatch });
  live.current = { logic, cap, selection: state.editor.selection, rankId, structural, dispatch };

  useEffect(() => {
    if (!host.current) return;
    registerBlocks();
    const canvas = Blockly.inject(host.current, { toolbox: { kind: "flyoutToolbox", contents: [] }, trashcan: false,
      sounds: false, zoom: { controls: true, wheel: true, startScale: 1 } });
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.workspaceId !== canvas.id) return;
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        const created = event as Blockly.Events.BlockCreate;
        const block = created.ids?.map((id) => canvas.getBlockById(id)).find((item) => item?.type === "rt_add_condition");
        const current = live.current;
        const operation = qualificationDropOperation(current.rankId, current.cap);
        if (!block || !operation || busy.current) return;
        busy.current = true;
        const target = operation.rank_component_id;
        void current.structural.apply(operation,
          semanticSelection("qualification", `${target}_qualification`, { fieldPath: "config.threshold", groupId: current.selection?.groupId ?? null }))
          .then((ok) => { if (!ok) { canvas.getBlockById(block.id)?.dispose(); setNotice("The backend rejected that block. Strategy unchanged."); } else setNotice(null); })
          .finally(() => { busy.current = false; });
      }
      if (event.type === Blockly.Events.SELECTED) {
        const block = Blockly.common.getSelected();
        if (!(block instanceof Blockly.Block) || block.workspace !== canvas || !block.data) return;
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
          block.setDeletable(false); block.setMovable(false); block.contextMenu = false;
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
    workspace.current?.updateToolbox({ kind: "flyoutToolbox", contents: canCondition ? [{ kind: "block", type: "rt_add_condition" }] : [] });
  }, [canCondition]);

  const chooseTarget = contextGroup?.allocationComponentId && cap?.choose_pipeline_targets.includes(contextGroup.allocationComponentId) ? contextGroup.allocationComponentId : null;
  const fallbackTarget = contextGroup?.allocationComponentId && cap?.fallback_add_targets.includes(contextGroup.allocationComponentId) ? contextGroup.allocationComponentId : null;
  const cooldownTarget = choose?.selectionComponentId && cap?.cooldown_add_targets.includes(choose.selectionComponentId) ? choose.selectionComponentId : null;
  return <div className="blocky-representation"><header className="representation-intro"><span className="eyebrow">Blocky</span><h1>Decision logic</h1><p>Read decisions in evaluation order. Drag an available qualification from the toolbox or edit a number; the backend validates each change.</p></header>
    {logic.unsupportedReason && <p role="status">This Strategy cannot yet be shown as logic blocks: {logic.unsupportedReason}</p>}
    <div className="blocky-canvas" ref={host} hidden={Boolean(logic.unsupportedReason)} aria-label="Strategy logic blocks" />
    <div className="blocky-actions">
      {chooseTarget && <ChooseTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => structural.apply({ kind: "transform_to_choose_assets", weight_component_id: chooseTarget, lookback_observations: lookback, count }, semanticSelection("selection", `${chooseTarget}_top_n`, { groupId: contextGroup?.id }))} />}
      {fallbackTarget && <FallbackTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(asset) => structural.apply({ kind: "add_fallback_selection", weight_component_id: fallbackTarget, fallback_asset: asset }, semanticSelection("fallback", `${fallbackTarget}_fallback`, { groupId: contextGroup?.id }))} />}
      {cooldownTarget && <CooldownConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(duration) => structural.apply({ kind: "add_cooldown_to_selection", selection_component_id: cooldownTarget, duration }, semanticSelection("cooldown", `${cooldownTarget}_cooldown`, { fieldPath: "config.duration", groupId: contextGroup?.id }))} />}
      {removable && <button className="text-button danger" disabled={structural.status === "applying"} onClick={() => void structural.apply(removable, null)}>Remove selected {selectedStep?.kind ?? "concept"}</button>}
    </div>{(notice || structural.error) && <p role="alert" className="structural-error">{notice ?? structural.error?.message}</p>}
  </div>;
}
