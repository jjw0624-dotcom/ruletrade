import * as Collapsible from "@radix-ui/react-collapsible";
import * as Tabs from "@radix-ui/react-tabs";
import { useState, type DragEvent } from "react";

import {
  projectBuilderStructure,
  semanticToolboxEntries,
  type ConstructionOption,
  type StructureItem,
  type ToolboxCategory,
} from "../domain/builderProjection";
import { blockyProgramToolboxEntries, PROGRAM_TOOLBOX_CATEGORIES } from "../domain/blockyToolbox";
import type { ConceptualFlowProjection } from "../domain/conceptualFlow";
import { sameSemanticSelection, semanticSelection } from "../domain/semanticSelection";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";
import {
  ChooseTransformationControl,
  FallbackTransformationControl,
  CooldownConstructionControl,
  GrowthDefensiveTransformationControl,
  MetricConstructionControl,
} from "./ShapeTransformationControls";
import { composeRankedSelectionPipeline, insertConditionBeforeRank } from "../domain/compositionIntents";
import { dispatchSplitConstruction } from "../domain/constructionDispatch";
import type { ProgramToolboxEntry } from "../domain/blockyToolbox";
import type { ProductNode } from "../domain/productSemantics";

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
  if (option.kind === "metric") return <div className="semantic-toolbox-item" draggable onDragStart={drag}><MetricConstructionControl busy={busy} error={structural.error} onApply={(lookback, count) => {
    const operation = composeRankedSelectionPipeline(state.canonical, option.targetComponentId, lookback, count);
    if (!operation) return Promise.resolve(false);
    return structural.compose(operation, (result) => semanticSelection("rule", result.created_component_ids.metric ?? null, { fieldPath: "config.lookback_bars", groupId }));
  }} /></div>;
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
  if (option.kind === "split") return <div className="semantic-toolbox-item" draggable onDragStart={drag}><GrowthDefensiveTransformationControl busy={busy} error={structural.error} onApply={(allocation, assets) => dispatchSplitConstruction(option, structural, allocation, assets)} /></div>;
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

export function BlockyProgramToolbox({ entries, structural }: {
  entries: ProgramToolboxEntry[];
  structural: StructuralAuthoringController;
}) {
  const { dispatch } = useStrategyEditor();
  const busy = structural.status === "checking" || structural.status === "applying";
  const [activeCategory, setActiveCategory] = useState(PROGRAM_TOOLBOX_CATEGORIES[0]);
  const categoryEntries = entries.filter((item) => item.category === activeCategory);
  const startDraftDrag = (event: DragEvent<HTMLButtonElement>, entry: ProgramToolboxEntry) => {
    if (!entry.draftKind) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-ruletrade-blocky-control", JSON.stringify({ kind: entry.draftKind }));
  };
  const startConceptDrag = (event: DragEvent<HTMLButtonElement>, option: ConstructionOption) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-ruletrade-concept", JSON.stringify({ kind: option.kind, targetComponentId: option.targetComponentId }));
  };
  return <div className="blocky-program-toolbox" data-program-toolbox>
    <nav className="blocky-toolbox-categories" aria-label="Block categories">
      {PROGRAM_TOOLBOX_CATEGORIES.map((category) => <button key={category} aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)}>{category}</button>)}
    </nav>
    <section className="blocky-toolbox-library" aria-label={`${activeCategory} blocks`}>
      {categoryEntries.map((entry) => <article className={`blocky-toolbox-entry ${entry.status}`} data-program-concept={entry.id} key={entry.id} title={entry.description}>
        <div className="blocky-toolbox-entry-label"><strong>{entry.label}</strong><small>{entry.statusLabel}</small></div>
        {entry.draftKind && <button className="blocky-toolbox-block" disabled={busy} draggable={!busy} onDragStart={(event) => startDraftDrag(event, entry)} onClick={() => dispatch({ type: "request_logic_control", kind: entry.draftKind! })} aria-describedby={`blocky-help-${entry.id}`}>{entry.label}<span className="sr-only"> — drag to the workspace or click to add</span></button>}
        {entry.options.map((option) => <button className="blocky-toolbox-block" disabled={busy} draggable={!busy} onDragStart={(event) => startConceptDrag(event, option)} key={`${option.kind}:${option.targetComponentId}`} title={`Drag ${entry.label} onto the Blocky workspace`}>{entry.label}<span className="sr-only"> — drag to the workspace</span></button>)}
        {entry.focusSelection && <button className="blocky-toolbox-block existing-block" onClick={() => dispatch({ type: "select_semantic", selection: entry.focusSelection })}>{entry.label}<span className="sr-only"> — focus existing</span></button>}
        {!entry.draftKind && !entry.predicateTarget && entry.options.length === 0 && !entry.focusSelection && <button className="blocky-toolbox-block" disabled>{entry.label}</button>}
        <span className="sr-only" id={`blocky-help-${entry.id}`}>{entry.description}</span>
      </article>)}
    </section>
  </div>;
}

function compactAvailabilityLabel(availability: ReturnType<typeof semanticToolboxEntries>[number]["availability"]): string {
  if (availability === "available_now") return "Ready";
  if (availability === "needs_context") return "Needs context";
  return "Unavailable";
}

export function FlowCapitalToolbox({ entries, structural }: { entries: ReturnType<typeof semanticToolboxEntries>; structural: StructuralAuthoringController }) {
  const { dispatch } = useStrategyEditor();
  const categories: ToolboxCategory[] = ["Capital", "Destination", "Routing", "Allocation", "Timing", "Behavior"];
  const [activeCategory, setActiveCategory] = useState<ToolboxCategory>("Capital");
  const displayed = entries.filter((entry) => entry.category === activeCategory);
  const busy = structural.status === "checking" || structural.status === "applying";
  const startDrag = (event: DragEvent<HTMLButtonElement>, option: ConstructionOption) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-ruletrade-concept", JSON.stringify({ kind: option.kind, targetComponentId: option.targetComponentId }));
  };
  const start = (option: ConstructionOption) => {
    if (option.kind === "split") {
      void dispatchSplitConstruction(option, structural);
      return;
    }
    dispatch({ type: "select_semantic", selection: option.anchorSelection });
    dispatch({ type: "begin_flow_draft", intent: {
      kind: option.kind, targetComponentId: option.targetComponentId, targetLabel: option.targetLabel, groupId: option.groupId,
    } });
  };
  return <div className="flow-capital-toolbox" data-flow-toolbox data-flow-toolbox-contract="compact-capital-v1" data-flow-toolbox-mode={activeCategory}>
    <nav className="flow-toolbox-categories" aria-label="Flow categories">
      {categories.map((category) => <button key={category} aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)}>{category}</button>)}
    </nav>
    <section className="flow-toolbox-library" aria-label={`${activeCategory} Flow tools`} data-scroll-container="bounded" role="list">
      {displayed.map((entry) => <div className={`flow-toolbox-entry ${entry.availability}`} data-toolbox-concept={entry.id} key={entry.id} role="listitem">
        {entry.options.map((option) => <button className="flow-toolbox-block" key={`${option.kind}:${option.targetComponentId}`}
          disabled={busy} draggable={!busy} onDragStart={(event) => startDrag(event, option)}
          onClick={() => start(option)} aria-describedby={`flow-tool-help-${entry.id}`}>
          <strong>{entry.label}</strong><small>{compactAvailabilityLabel(entry.availability)}</small>
          <span className="sr-only" id={`flow-tool-help-${entry.id}`}>{entry.description}. Drag onto Flow or click to begin.</span>
        </button>)}
        {entry.options.length === 0 && <button className="flow-toolbox-block" disabled aria-describedby={`flow-tool-help-${entry.id}`}>
          <strong>{entry.label}</strong><small>{compactAvailabilityLabel(entry.availability)}</small>
          <span className="sr-only" id={`flow-tool-help-${entry.id}`}>{entry.description}</span>
        </button>}
      </div>)}
    </section>
  </div>;
}

function CanonicalV1WorkspaceLeftPanel({ projection, structural }: {
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
}) {
  const { state, dispatch } = useStrategyEditor();
  const structure = projectBuilderStructure(projection);
  const perspective = state.editor.activeView === "blocky" ? "blocky" : "flow";
  const library = semanticToolboxEntries(projection, state.registry, structural.capabilities, state.editor.selection, perspective);
  const programLibrary = blockyProgramToolboxEntries(projection, structural.capabilities, state.editor.selection);
  return <Collapsible.Root
    className="workspace-left-root"
    open={state.editor.leftPanelOpen}
    onOpenChange={(open) => dispatch({ type: "set_left_panel_open", open })}
  >
    <Collapsible.Trigger className="workspace-panel-toggle" aria-label={state.editor.leftPanelOpen ? "Collapse construction panel" : "Open construction panel"}>
      {state.editor.leftPanelOpen ? "‹" : "›"}
    </Collapsible.Trigger>
    <Collapsible.Content className="workspace-left-panel" data-perspective={perspective}>
      <Tabs.Root className="workspace-left-tabs" value={state.editor.leftPanelTab} onValueChange={(tab) => dispatch({ type: "set_left_panel_tab", tab: tab as "structure" | "blocks" })}>
        <Tabs.List className="workspace-panel-tabs" aria-label="Builder tools">
          <Tabs.Trigger value="structure">Structure</Tabs.Trigger>
          <Tabs.Trigger value="blocks">Add</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="structure" className="structure-panel">
          <ul className="structure-tree"><StructureBranch item={structure} /></ul>
          <p className="panel-hint">Select an investment object to inspect it everywhere.</p>
        </Tabs.Content>
        <Tabs.Content value="blocks" className="blocks-panel" data-perspective={perspective}>
          {perspective === "blocky"
            ? <BlockyProgramToolbox entries={programLibrary} structural={structural} />
            : <FlowCapitalToolbox entries={library} structural={structural} />}
        </Tabs.Content>
      </Tabs.Root>
    </Collapsible.Content>
  </Collapsible.Root>;
}


export interface ProductAddAction {
  id: string;
  category: ToolboxCategory;
  label: string;
  description: string;
  disabled: boolean;
  availability?: "ready" | "needs_context" | "unavailable";
  onAdd: () => void;
}

export type ProductStructureNode = ProductNode;

function ProductStructureBranch({ item, depth, selectedId, onSelect }: { item: ProductStructureNode; depth: number; selectedId: string | null; onSelect: (id: string) => void }) {
  return <li><button className={selectedId === item.id ? "structure-item selected" : "structure-item"} style={{ paddingLeft: `${12 + depth * 15}px` }} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}><span>{item.label}</span>{item.detail && <small>{item.detail}</small>}</button>{item.children.length > 0 && <ul>{item.children.map((child) => <ProductStructureBranch key={child.id} item={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}</ul>}</li>;
}

function SemanticProgramWorkspaceLeftPanel({ tools, structure, selectedId, onSelect }: {
  tools: ProductAddAction[];
  structure: ProductStructureNode;
  selectedId: string | null;
  onSelect: (semanticId: string) => void;
}) {
  const categories: ProductAddAction["category"][] = ["Capital", "Destination", "Routing", "Allocation", "Timing", "Behavior"];
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"structure" | "blocks">("structure");
  const [category, setCategory] = useState<ProductAddAction["category"]>("Capital");
  const displayed = tools.filter((tool) => tool.category === category);
  return <Collapsible.Root className="workspace-left-root" open={open} onOpenChange={setOpen}>
    <Collapsible.Trigger className="workspace-panel-toggle" aria-label={open ? "Collapse construction panel" : "Open construction panel"}>{open ? "‹" : "›"}</Collapsible.Trigger>
    <Collapsible.Content className="workspace-left-panel" data-perspective="blocky" data-builder-tools="contextual">
      <Tabs.Root className="workspace-left-tabs" value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <Tabs.List className="workspace-panel-tabs" aria-label="Builder tools"><Tabs.Trigger value="structure">Structure</Tabs.Trigger><Tabs.Trigger value="blocks">Add</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="structure" className="structure-panel"><ul className="structure-tree"><ProductStructureBranch item={structure} depth={0} selectedId={selectedId} onSelect={onSelect} /></ul><p className="panel-hint">Select an investment object to inspect it everywhere.</p></Tabs.Content>
        <Tabs.Content value="blocks" forceMount className="blocks-panel"><div className="blocky-program-toolbox">
          <nav className="blocky-toolbox-categories" aria-label="Strategy construction categories">{categories.map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</nav>
          <section className="blocky-toolbox-library" aria-label={`${category} blocks`} data-scroll-container="bounded">{displayed.map((tool) => {
            const availability = tool.availability ?? (tool.disabled ? "unavailable" : "ready");
            const status = availability === "ready" ? "Ready" : availability === "needs_context" ? "Needs context" : "Unavailable";
            return <article className={`blocky-toolbox-entry ${availability}`} key={tool.id} role="listitem"><button type="button" className="blocky-toolbox-block" disabled={tool.disabled} aria-describedby={`${tool.id}-description`} onClick={tool.onAdd}><span className="blocky-toolbox-title"><strong>{tool.label}</strong><small aria-label="Availability status">{status}</small></span></button><p id={`${tool.id}-description`}>{tool.description}</p></article>;
          })}</section>
        </div></Tabs.Content>
      </Tabs.Root>
    </Collapsible.Content>
  </Collapsible.Root>;
}

export function WorkspaceLeftPanel(props: ({
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
} | {
  semanticProgram: {
    tools: ProductAddAction[];
    structure: ProductStructureNode;
    selectedId: string | null;
    onSelect: (semanticId: string) => void;
  };
})) {
  if ("semanticProgram" in props) return <SemanticProgramWorkspaceLeftPanel {...props.semanticProgram} />;
  return <CanonicalV1WorkspaceLeftPanel {...props} />;
}
