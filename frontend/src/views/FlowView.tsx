import { useEffect, useMemo, type ReactNode } from "react";
import { Background, Controls, MarkerType, Position, ReactFlow, useNodesState, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AssetMembershipEditor, LookbackControl, ScheduleControl, SleeveAllocationEditor } from "../components/AuthoringControls";
import { ChooseTransformationControl, FallbackTransformationControl, GrowthDefensiveTransformationControl } from "../components/ShapeTransformationControls";
import { GroupRenameControl, QualificationAuthoringControl } from "../components/StructuralAuthoringControls";
import { projectConceptualFlow, type ConceptualChoose, type ConceptualGroup } from "../domain/conceptualFlow";
import { useStructuralAuthoring, type StructuralStatus } from "../hooks/useStructuralAuthoring";
import type { StructuralAuthoringCapabilities, StructuralAuthoringOperation } from "../structuralAuthoringApi";
import { useStrategyEditor } from "../store/editorStore";

type Selection = { kind: "portfolio" } | { kind: "split" } | { kind: "group"; group: ConceptualGroup } | { kind: "choose"; group: ConceptualGroup; choose: ConceptualChoose };
type CanvasData = Record<string, unknown> & { label: ReactNode; conceptId: string; componentId?: string; groupId?: string };
type CanvasNode = Node<CanvasData>;
type Structural = { capabilities: StructuralAuthoringCapabilities | null; status: StructuralStatus; error: { message: string; detail?: string } | null; apply: (operation: StructuralAuthoringOperation, focus?: { componentId?: string | null; conceptId?: string | null }) => Promise<boolean> };

export function shapeTransformationTargets(capabilities: StructuralAuthoringCapabilities | null) {
  return {
    choose: capabilities?.choose_pipeline_targets[0],
    fallback: capabilities?.fallback_add_targets[0],
    growthDefensive: capabilities?.growth_defensive_targets[0],
  };
}

const node = (id: string, x: number, y: number, conceptId: string, title: string, detail: string, options: { componentId?: string; groupId?: string; tone?: string } = {}): CanvasNode => ({
  id, position: { x, y }, sourcePosition: Position.Bottom, targetPosition: Position.Top,
  className: `strategy-flow-node ${options.tone ?? ""}`,
  data: { conceptId, componentId: options.componentId, groupId: options.groupId, label: <div className="flow-node-label"><strong>{title}</strong><span>{detail}</span></div> },
});
const edge = (id: string, source: string, target: string, label?: string): Edge => ({ id, source, target, label, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed }, className: "strategy-flow-edge" });

function canvasGraph(projection: ReturnType<typeof projectConceptualFlow>, group?: ConceptualGroup) {
  if (group) {
    const nodes: CanvasNode[] = [node("assets", 40, 120, `group:${group.id}`, `${group.label} assets`, group.assets.join(" · "), { componentId: group.sourceComponentIds[0], tone: "group" })];
    const edges: Edge[] = [];
    if (group.choose) {
      nodes.push(node("choose", 360, 120, "choose", group.choose.label, [group.choose.condition, group.choose.ranking].filter(Boolean).join(" · "), { componentId: group.choose.selectionComponentId, tone: "choose" }));
      edges.push(edge("assets-choose", "assets", "choose", "consider"));
      if (group.choose.otherwise) {
        nodes.push(node("fallback", 680, 280, "fallback", group.choose.otherwise.replace("Otherwise → ", ""), "Fallback destination", { componentId: group.choose.fallbackComponentId, tone: "fallback" }));
        edges.push(edge("choose-fallback", "choose", "fallback", "if incomplete"));
      }
    }
    return { nodes, edges };
  }
  const nodes: CanvasNode[] = [node("portfolio", 320, 20, "portfolio", "Portfolio", projection.rebalance ? `Rebalance: ${projection.rebalance}` : "All invested money", { tone: "portfolio" })];
  const edges: Edge[] = [];
  if (projection.split) {
    nodes.push(node("split", 320, 170, "split", "Split money", projection.groups.map((item) => item.allocation).join(" / "), { tone: "split" }));
    edges.push(edge("portfolio-split", "portfolio", "split"));
    projection.groups.forEach((item, index) => {
      const id = `group-${item.id}`;
      nodes.push(node(id, 70 + index * 360, 350, `group:${item.id}`, `${item.label} ${item.allocation ?? ""}`.trim(), item.choose?.label ?? item.assets.join(" · "), { componentId: item.sourceComponentIds[0], groupId: item.id, tone: "group" }));
      edges.push(edge(`split-${id}`, "split", id, item.allocation));
    });
  } else {
    const item = projection.groups[0];
    if (item) {
      nodes.push(node("group", 320, 250, `group:${item.id}`, item.label, item.choose?.label ?? item.assets.join(" · "), { componentId: item.sourceComponentIds[0], groupId: item.id, tone: "group" }));
      edges.push(edge("portfolio-group", "portfolio", "group", item.allocation));
    }
  }
  return { nodes, edges };
}

export function FlowView() {
  const { state, dispatch } = useStrategyEditor();
  const projection = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const structural = useStructuralAuthoring();
  const group = projection.groups.find((item) => item.id === state.editor.openGroupId);
  const graph = useMemo(() => canvasGraph(projection, group), [projection, group]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(graph.nodes);
  useEffect(() => { setNodes((current) => graph.nodes.map((next) => ({ ...next, position: current.find((item) => item.id === next.id)?.position ?? next.position }))); }, [graph, setNodes]);
  const selected = selectionFor(state.editor.selectedConceptId, group, projection.groups);
  const displayNodes = nodes.map((item) => ({ ...item, selected: item.data.conceptId === state.editor.selectedConceptId }));
  const select = (conceptId: string, componentId?: string) => { dispatch({ type: "select_concept", conceptId }); dispatch({ type: "select_node", componentId: componentId ?? null }); };
  return <section className="intuitive-flow xyflow-builder" aria-label="Visual strategy builder" onKeyDown={(event) => { if (event.key === "Escape") dispatch({ type: "select_concept", conceptId: null }); }} tabIndex={-1}>
    <Library group={group} />
    <main className="intuitive-canvas-wrap"><nav className="concept-breadcrumb" aria-label="Strategy hierarchy"><button onClick={() => dispatch({ type: "open_group", groupId: null })}>Portfolio</button>{group && <><span>/</span><strong>{group.label}</strong></>}</nav><div className="intuitive-canvas"><ReactFlow nodes={displayNodes} edges={graph.edges} onNodesChange={onNodesChange} onNodeClick={(_, selectedNode) => select(selectedNode.data.conceptId, selectedNode.data.componentId)} onNodeDoubleClick={(_, selectedNode) => { if (selectedNode.data.groupId) dispatch({ type: "open_group", groupId: selectedNode.data.groupId }); }} onPaneClick={() => dispatch({ type: "select_concept", conceptId: null })} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.45} maxZoom={1.6} nodesConnectable={false} deleteKeyCode={null}><Background gap={24} size={1} /><Controls showInteractive={false} /></ReactFlow></div></main>
    <Inspector selection={selected} projection={projection} structural={structural} />
  </section>;
}

function Library({ group }: { group?: ConceptualGroup }) { return <aside className="object-library"><span className="eyebrow">Strategy map</span><h3>{group ? group.label : "Portfolio"}</h3><p>Select a connected object to inspect or evolve the real strategy.</p><div className="library-legend"><span><i className="legend-swatch split" />Split money</span><span><i className="legend-swatch choose" />Choose assets</span><span><i className="legend-swatch fallback" />Otherwise</span></div><small>{group ? "Use the Inspector for properties and supported transformations." : "Double-click a Group to open its connected selection flow."}</small></aside>; }
function selectionFor(id: string | null, group: ConceptualGroup | undefined, groups: ConceptualGroup[]): Selection { if (id === "split") return { kind: "split" }; if ((id === "choose" || id === "fallback") && group?.choose) return { kind: "choose", group, choose: group.choose }; if (id?.startsWith("group:")) { const found = groups.find((item) => `group:${item.id}` === id); if (found) return { kind: "group", group: found }; } return { kind: "portfolio" }; }
function Inspector({ selection, projection, structural }: { selection: Selection; projection: ReturnType<typeof projectConceptualFlow>; structural: Structural }) { if (selection.kind === "split" && projection.split) return <SplitInspector groups={projection.split.groups} />; if (selection.kind === "choose") return <ChooseInspector group={selection.group} choose={selection.choose} structural={structural} />; if (selection.kind === "group") return <GroupInspector group={selection.group} structural={structural} />; return <PortfolioInspector projection={projection} structural={structural} />; }

function PortfolioInspector({ projection, structural }: { projection: ReturnType<typeof projectConceptualFlow>; structural: Structural }) {
  const { dispatch } = useStrategyEditor(); const targets = shapeTransformationTargets(structural.capabilities); const chooseTarget = targets.choose; const splitTarget = targets.growthDefensive; const group = projection.groups[0];
  return <aside className="flow-inspector"><span className="eyebrow">Portfolio</span><h3>{projection.title}</h3><p>Money can go to {projection.groups.map((item) => item.label).join(" and ")}.</p>{projection.rebalanceScheduleComponentId && <ScheduleControl label="Rebalance portfolio" componentId={projection.rebalanceScheduleComponentId} value={projection.rebalance!} />}
    {chooseTarget && <ChooseTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={async (lookback, count) => { const applied = await structural.apply({ kind: "transform_to_choose_assets", weight_component_id: chooseTarget, lookback_observations: lookback, count }, { conceptId: "choose" }); if (applied && group) { dispatch({ type: "open_group", groupId: group.id }); dispatch({ type: "select_concept", conceptId: "choose" }); } return applied; }} />}
    {splitTarget && <GrowthDefensiveTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={async (growthAllocation, defensiveAssets) => { const applied = await structural.apply({ kind: "transform_to_growth_defensive", target_component_id: splitTarget, growth_allocation: growthAllocation, defensive_assets: defensiveAssets }, { conceptId: "portfolio" }); if (applied) dispatch({ type: "open_group", groupId: null }); return applied; }} />}
    <small>Canvas position and viewport are visual only. Every structural change is applied and validated by the backend.</small></aside>;
}

function ChooseInspector({ group, choose, structural }: { group: ConceptualGroup; choose: ConceptualChoose; structural: Structural }) {
  const { dispatch } = useStrategyEditor(); const fallbackTarget = shapeTransformationTargets(structural.capabilities).fallback;
  return <aside className="flow-inspector"><span className="eyebrow">Choose assets</span><h3>{choose.label}</h3><label>From<input value={group.label} disabled /></label>
    {choose.rankComponentId && <QualificationAuthoringControl rankComponentId={choose.rankComponentId} filterComponentId={choose.filterComponentId} lookbackBars={choose.lookbackBars!} threshold={choose.threshold} capabilities={structural.capabilities} busy={structural.status === "applying"} error={structural.error} onAdd={() => structural.apply({ kind: "add_qualification_condition", rank_component_id: choose.rankComponentId! }, { componentId: `${choose.rankComponentId}_qualification`, conceptId: "choose" })} onRemove={() => structural.apply({ kind: "remove_qualification_condition", condition_component_id: choose.filterComponentId! }, { componentId: choose.rankComponentId, conceptId: "choose" })} />}
    {choose.lookbackComponentId && <LookbackControl id="flow-lookback" componentId={choose.lookbackComponentId} value={choose.lookbackBars!} />}
    {choose.filterComponentId && <label>Only include when<span className="condition-input"><b>Return is greater than</b><input aria-label="Return threshold percent" type="number" step="0.1" value={Number(choose.threshold) * 100} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.filterComponentId!, field: "threshold", value: String(Number(event.target.value) / 100) } })} />%</span></label>}
    {choose.selectionMode === "ranked" ? <label>Then order<input value="Strongest return first" disabled /><small>The current Rank contract supports this direction only.</small></label> : <label>How should it choose?<select value={choose.resample} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.selectionComponentId, field: "resample", value: event.target.value } })}><option value="per_event">Choose again each check</option><option value="once">Keep the first random choice</option></select></label>}
    <label>Choose<input type="number" min={1} value={choose.topN} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.selectionComponentId, field: "count", value: Number(event.target.value) } })} /></label><p className="fixed-setting">Split selected assets equally</p>
    {choose.fallbackComponentId && <label>Otherwise<select value={choose.fallbackAssetSetRef} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.fallbackComponentId!, field: "fallback_asset_set_ref", value: event.target.value } })}>{choose.fallbackOptions.map((option) => <option key={option.id} value={option.id}>{option.asset}</option>)}</select></label>}
    {fallbackTarget && <FallbackTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(asset) => structural.apply({ kind: "add_fallback_selection", weight_component_id: fallbackTarget, fallback_asset: asset }, { conceptId: "choose" })} />}
    {choose.cooldownComponentId && <label>After selling, wait<input type="number" min={1} value={choose.cooldownDuration} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.cooldownComponentId!, field: "duration", value: Number(event.target.value) } })} /><span>completed trading days before buying again</span></label>}{choose.scheduleComponentId && <ScheduleControl label="Check choices" componentId={choose.scheduleComponentId} value={choose.timing!} />}</aside>;
}
function GroupInspector({ group, structural }: { group: ConceptualGroup; structural: Structural }) { return <aside className="flow-inspector"><span className="eyebrow">Group</span>{group.sleeveComponentId ? <GroupRenameControl componentId={group.sleeveComponentId} name={group.label} capabilities={structural.capabilities} busy={structural.status === "applying"} error={structural.error} onRename={(name) => structural.apply({ kind: "rename_group", group_component_id: group.sleeveComponentId!, name }, { componentId: group.sleeveComponentId, conceptId: `group:${group.id}` })} /> : <h3>{group.label}</h3>}{group.assetSetId ? <AssetMembershipEditor question="Where can money go?" assetSetId={group.assetSetId} assets={group.assets} /> : <p>{group.assets.join(" · ")}</p>}{group.scheduleComponentId && <ScheduleControl label="Check choices" componentId={group.scheduleComponentId} value={group.timing!} />}</aside>; }
function SplitInspector({ groups }: { groups: Array<{ id: string; label: string; componentId: string; allocation: string }> }) { return <aside className="flow-inspector"><span className="eyebrow">Split money</span><h3>Portfolio allocation</h3><SleeveAllocationEditor groups={groups} /></aside>; }
