import * as Collapsible from "@radix-ui/react-collapsible";
import * as Tabs from "@radix-ui/react-tabs";

import {
  constructionOptions,
  projectBuilderStructure,
  type ConstructionOption,
  type StructureItem,
} from "../domain/builderProjection";
import type { ConceptualFlowProjection } from "../domain/conceptualFlow";
import { sameSemanticSelection, semanticSelection } from "../domain/semanticSelection";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";
import {
  ChooseTransformationControl,
  FallbackTransformationControl,
  CooldownConstructionControl,
  GrowthDefensiveTransformationControl,
} from "./ShapeTransformationControls";

function StructureBranch({ item, depth = 0 }: { item: StructureItem; depth?: number }) {
  const { state, dispatch } = useStrategyEditor();
  const selected = sameSemanticSelection(state.editor.selection, item.selection);
  return <li>
    <button
      className={selected ? "structure-item selected" : "structure-item"}
      style={{ paddingLeft: `${12 + depth * 15}px` }}
      aria-pressed={selected}
      onClick={() => dispatch({ type: "select_semantic", selection: item.selection })}
    >
      <span>{item.label}</span>{item.detail && <small>{item.detail}</small>}
    </button>
    {item.children.length > 0 && <ul>{item.children.map((child) => <StructureBranch key={child.id} item={child} depth={depth + 1} />)}</ul>}
  </li>;
}

export function ConstructionControl({ option, structural }: {
  option: ConstructionOption;
  structural: StructuralAuthoringController;
}) {
  const groupId = option.groupId;
  const busy = structural.status === "applying";
  if (option.kind === "choose") return <ChooseTransformationControl busy={busy} error={structural.error} onApply={(lookback, count) => structural.apply({
    kind: "transform_to_choose_assets",
    weight_component_id: option.targetComponentId,
    lookback_observations: lookback,
    count,
  }, semanticSelection("selection", `${option.targetComponentId}_top_n`, { groupId }))} />;
  if (option.kind === "fallback") return <FallbackTransformationControl busy={busy} error={structural.error} onApply={(asset) => structural.apply({
    kind: "add_fallback_selection",
    weight_component_id: option.targetComponentId,
    fallback_asset: asset,
  }, semanticSelection("fallback", `${option.targetComponentId}_fallback`, { groupId }))} />;
  if (option.kind === "split") return <GrowthDefensiveTransformationControl busy={busy} error={structural.error} onApply={(allocation, assets) => structural.apply({
    kind: "transform_to_growth_defensive",
    target_component_id: option.targetComponentId,
    growth_allocation: allocation,
    defensive_assets: assets,
  }, semanticSelection("split", `${option.targetComponentId}_portfolio`))} />;
  if (option.kind === "cooldown") return <CooldownConstructionControl busy={busy} error={structural.error} onApply={(duration) => structural.apply({
    kind: "add_cooldown_to_selection", selection_component_id: option.targetComponentId, duration,
  }, semanticSelection("cooldown", `${option.targetComponentId}_cooldown`, { fieldPath: "config.duration", groupId }))} />;
  return <section className="construction-card" data-construction-kind={option.kind}>
    <strong>{option.label}</strong><small>{option.targetLabel}</small><p>{option.description}</p>
    <button className="secondary-button" disabled={busy} onClick={() => void structural.apply({
      kind: "add_qualification_condition",
      rank_component_id: option.targetComponentId,
    }, semanticSelection("qualification", `${option.targetComponentId}_qualification`, { fieldPath: "config.threshold", groupId }))}>Add to selection</button>
  </section>;
}

export function WorkspaceLeftPanel({ projection, structural }: {
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
}) {
  const { state, dispatch } = useStrategyEditor();
  const structure = projectBuilderStructure(projection);
  const options = constructionOptions(projection, structural.capabilities, state.editor.selection);
  return <Collapsible.Root
    className="workspace-left-root"
    open={state.editor.leftPanelOpen}
    onOpenChange={(open) => dispatch({ type: "set_left_panel_open", open })}
  >
    <Collapsible.Trigger className="workspace-panel-toggle" aria-label={state.editor.leftPanelOpen ? "Collapse construction panel" : "Open construction panel"}>
      {state.editor.leftPanelOpen ? "‹" : "›"}
    </Collapsible.Trigger>
    <Collapsible.Content className="workspace-left-panel">
      <Tabs.Root value={state.editor.leftPanelTab} onValueChange={(tab) => dispatch({ type: "set_left_panel_tab", tab: tab as "structure" | "blocks" })}>
        <Tabs.List className="workspace-panel-tabs" aria-label="Builder tools">
          <Tabs.Trigger value="structure">Structure</Tabs.Trigger>
          <Tabs.Trigger value="blocks">Add</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="structure" className="structure-panel">
          <ul className="structure-tree"><StructureBranch item={structure} /></ul>
          <p className="panel-hint">Select an investment object to inspect it everywhere.</p>
        </Tabs.Content>
        <Tabs.Content value="blocks" className="blocks-panel">
          <header><span className="eyebrow">Construction</span><h2>Add to this Strategy</h2></header>
          {structural.status === "checking" && <p role="status">Checking what fits here…</p>}
          {structural.status !== "checking" && options.length === 0 && <div className="construction-empty"><strong>No supported additions</strong><p>This Strategy already uses every concept the current executable grammar can add here.</p></div>}
          {options.length > 1 && <p className="panel-hint">Choose a concept and its valid Strategy location. The backend remains the authority.</p>}
          {options.map((option) => <ConstructionControl key={`${option.kind}:${option.targetComponentId}`} option={option} structural={structural} />)}
        </Tabs.Content>
      </Tabs.Root>
    </Collapsible.Content>
  </Collapsible.Root>;
}
