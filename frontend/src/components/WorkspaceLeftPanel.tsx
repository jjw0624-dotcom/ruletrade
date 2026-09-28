import * as Collapsible from "@radix-ui/react-collapsible";
import * as Tabs from "@radix-ui/react-tabs";
import type { DragEvent } from "react";

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
import { composeTwoSleevePortfolio, insertConditionBeforeRank } from "../domain/compositionIntents";

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
  const { state } = useStrategyEditor();
  const groupId = option.groupId;
  const busy = structural.status === "applying";
  const drag = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-ruletrade-concept", JSON.stringify({ kind: option.kind, targetComponentId: option.targetComponentId }));
  };
  if (option.kind === "choose") return <div className="semantic-toolbox-item" draggable onDragStart={drag}><ChooseTransformationControl busy={busy} error={structural.error} onApply={(lookback, count) => structural.apply({
    kind: "transform_to_choose_assets",
    weight_component_id: option.targetComponentId,
    lookback_observations: lookback,
    count,
  }, semanticSelection("selection", `${option.targetComponentId}_top_n`, { groupId }))} /></div>;
  if (option.kind === "fallback") return <div className="semantic-toolbox-item" draggable onDragStart={drag}><FallbackTransformationControl busy={busy} error={structural.error} onApply={(asset) => structural.apply({
    kind: "add_fallback_selection",
    weight_component_id: option.targetComponentId,
    fallback_asset: asset,
  }, semanticSelection("fallback", `${option.targetComponentId}_fallback`, { groupId }))} /></div>;
  if (option.kind === "split") return <div className="semantic-toolbox-item" draggable onDragStart={drag}><GrowthDefensiveTransformationControl busy={busy} error={structural.error} onApply={(allocation, assets) => {
    const operation = composeTwoSleevePortfolio(state.canonical, option.targetComponentId, allocation, assets);
    if (!operation) return Promise.resolve(false);
    return structural.compose(operation, (result) => semanticSelection("split", result.created_component_ids.portfolio ?? null));
  }} /></div>;
  if (option.kind === "cooldown") return <div className="semantic-toolbox-item" draggable onDragStart={drag}><CooldownConstructionControl busy={busy} error={structural.error} onApply={(duration) => structural.apply({
    kind: "add_cooldown_to_selection", selection_component_id: option.targetComponentId, duration,
  }, semanticSelection("cooldown", `${option.targetComponentId}_cooldown`, { fieldPath: "config.duration", groupId }))} /></div>;
  return <section className="construction-card" data-construction-kind={option.kind} draggable
    onDragStart={drag}>
    <strong>{option.label}</strong><small>{option.targetLabel}</small><p>{option.description}</p>
    <button className="secondary-button" disabled={busy} onClick={() => {
      const operation = insertConditionBeforeRank(state.canonical, option.targetComponentId);
      if (operation) void structural.compose(operation, (result) => semanticSelection("qualification", result.created_component_ids.condition ?? null, { fieldPath: "config.threshold", groupId }));
    }}>Add to selection</button>
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
          <header><span className="eyebrow">Semantic toolbox</span><h2>Add to this Strategy</h2><p>Build with executable concepts. Recipes remain in Guide.</p></header>
          {structural.status === "checking" && <p role="status">Checking what fits here…</p>}
          {structural.status !== "checking" && options.length === 0 && <div className="construction-empty"><strong>No supported additions</strong><p>This Strategy already uses every concept the current executable grammar can add here.</p></div>}
          {options.length > 1 && <p className="panel-hint">Choose a concept and its valid Strategy location. The backend remains the authority.</p>}
          {(["Portfolio", "Decision / routing"] as const).map((category) => {
            const categoryOptions = options.filter((option) => option.category === category);
            return categoryOptions.length > 0 && <section className="construction-category" key={category}><h3>{category}</h3>
              {categoryOptions.map((option) => <ConstructionControl key={`${option.kind}:${option.targetComponentId}`} option={option} structural={structural} />)}
            </section>;
          })}
        </Tabs.Content>
      </Tabs.Root>
    </Collapsible.Content>
  </Collapsible.Root>;
}
