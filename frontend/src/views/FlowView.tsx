import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { constructionOptions, semanticDeleteOperation, type ConstructionOption } from "../domain/builderProjection";
import { composeRankedSelectionPipeline, composeTwoSleevePortfolio, insertConditionBeforeRank } from "../domain/compositionIntents";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { isCompatibleFlowConnection, type FlowSemanticKind } from "../domain/flowDraft";
import { sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";
import {
  ChooseTransformationControl, CooldownConstructionControl, FallbackTransformationControl,
  GrowthDefensiveTransformationControl, MetricConstructionControl,
} from "../components/ShapeTransformationControls";

export function shapeTransformationTargets(capabilities: StructuralAuthoringController["capabilities"]) {
  return {
    choose: capabilities?.choose_pipeline_targets[0],
    fallback: capabilities?.fallback_add_targets[0],
    growthDefensive: capabilities?.growth_defensive_targets[0],
  };
}

export type SemanticNodeData = Record<string, unknown> & {
  title: string;
  detail: string;
  tone?: string;
  selection: SemanticSelection;
  semanticKind: FlowSemanticKind;
};
export type SemanticNode = Node<SemanticNodeData, "semantic">;

function SemanticFlowNode({ data, selected }: NodeProps<SemanticNode>) {
  const hasTarget = data.semanticKind !== "portfolio" && data.semanticKind !== "schedule";
  const hasSource = !["action", "fallback", "constraint"].includes(data.semanticKind);
  return <div className={`semantic-flow-node ${data.tone ?? ""}${selected ? " selected" : ""}`}
    role="button" tabIndex={0} aria-label={`${data.title}: ${data.detail}`} data-semantic-kind={data.semanticKind}>
    {hasTarget && <Handle type="target" position={Position.Top} />}
    <strong>{data.title}</strong><span>{data.detail}</span>
    {data.semanticKind === "predicate"
      ? <><Handle id="true" type="source" position={Position.Bottom} style={{ left: "32%" }} /><Handle id="false" type="source" position={Position.Bottom} style={{ left: "68%" }} /></>
      : hasSource && <Handle type="source" position={Position.Bottom} />}
  </div>;
}
const nodeTypes = { semantic: SemanticFlowNode };

const node = (
  id: string, x: number, y: number, title: string, detail: string,
  selection: SemanticSelection, semanticKind: FlowSemanticKind, tone?: string,
): SemanticNode => ({ id, type: "semantic", position: { x, y }, data: { title, detail, selection, semanticKind, tone } });

const edge = (
  source: string, target: string, label?: string, className = "strategy-flow-edge",
  sourceHandle?: string,
): Edge => ({
  id: `${source}-${target}-${sourceHandle ?? ""}-${label ?? ""}`, source, target, sourceHandle,
  label, type: "smoothstep", markerEnd: className.includes("timing") ? undefined : { type: MarkerType.ArrowClosed },
  className,
});

export function mergeFlowNodePositions(projected: SemanticNode[], current: SemanticNode[]): SemanticNode[] {
  const positions = new Map(current.map((item) => [item.id, item.position]));
  return projected.map((item) => ({ ...item, position: positions.get(item.id) ?? item.position }));
}

export function projectFlowCanvas(projection: ReturnType<typeof projectConceptualFlow>) {
  const nodes: SemanticNode[] = [];
  const edges: Edge[] = [];
  const rootId = "portfolio";
  if (projection.unsupportedReason) {
    nodes.push(node(rootId, 360, 20, "Unsupported strategy shape", projection.unsupportedReason, semanticSelection("portfolio", null), "portfolio"));
    return { nodes, edges };
  }

  nodes.push(node(rootId, 380, 20, projection.title, projection.kind === "portfolio" ? "Portfolio capital" : "Portfolio target", semanticSelection("portfolio", projection.portfolioComponentId ?? null), "portfolio"));
  let capitalParent = rootId;
  if (projection.split) {
    nodes.push(node("split", 380, 145, "Split capital", projection.groups.map((group) => group.allocation).join(" / "), semanticSelection("split", projection.portfolioComponentId ?? null), "allocation", "split"));
    edges.push(edge(rootId, "split", "capital"));
    capitalParent = "split";
  }

  projection.groups.forEach((group, index) => {
    const x = projection.groups.length === 1 ? 380 : 120 + index * 420;
    const baseY = projection.split ? 285 : 160;
    const groupId = `group:${group.id}`;
    nodes.push(node(groupId, x, baseY, group.label, group.allocation ? `${group.allocation} ownership` : "Investment exposure",
      semanticSelection("group", group.sleeveComponentId ?? group.universeComponentId ?? null, { groupId: group.id }), "group", index ? "defensive" : "growth"));
    edges.push(edge(capitalParent, groupId, group.allocation ?? "capital"));

    const universeId = `universe:${group.id}`;
    nodes.push(node(universeId, x, baseY + 135, group.universeLabel ?? "Universe", `${group.assets.length} assets · ${group.assets.join(" · ")}`,
      semanticSelection("universe", group.universeComponentId ?? null, { groupId: group.id }), "universe"));
    edges.push(edge(groupId, universeId, "considers"));

    let pipeline = universeId;
    let pipelineY = baseY + 270;
    if (group.choose?.filterComponentId) {
      const id = `qualification:${group.id}`;
      nodes.push(node(id, x, pipelineY, "Eligible candidates", group.choose.condition ?? "Supported eligibility",
        semanticSelection("qualification", group.choose.filterComponentId, { fieldPath: group.choose.eligibilityFieldPath ?? "config.threshold", groupId: group.id }),
        "eligibility", "qualification"));
      edges.push(edge(pipeline, id, "candidates"));
      pipeline = id;
      pipelineY += 135;
    }

    if (group.choose) {
      const choose = group.choose;
      const selectId = `selection:${group.id}`;
      const modifiers = [
        choose.ranking,
        choose.cooldown ? "cooldown attached" : null,
      ].filter(Boolean).join(" · ");
      nodes.push(node(selectId, x, pipelineY, choose.label, modifiers || "Selection",
        semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }), "selection", "selection"));
      edges.push(edge(pipeline, selectId, group.choose.filterComponentId ? "eligible candidates" : "candidates"));
      pipeline = selectId;

      if (choose.fallbackComponentId) {
        const id = `fallback:${group.id}`;
        nodes.push(node(id, x + 235, pipelineY, "Selection fallback", choose.otherwise ?? "Alternative destination",
          semanticSelection("fallback", choose.fallbackComponentId, { groupId: group.id }), "fallback", "fallback"));
        edges.push(edge(selectId, id, "if incomplete", "strategy-flow-edge modifier-edge"));
      }
      if (choose.cooldownComponentId) {
        const id = `cooldown:${group.id}`;
        nodes.push(node(id, x - 235, pipelineY, "Selection constraint", choose.cooldown ?? "Cooldown",
          semanticSelection("cooldown", choose.cooldownComponentId, { fieldPath: "config.duration", groupId: group.id }), "constraint", "constraint"));
        edges.push(edge(selectId, id, "modifies", "strategy-flow-edge modifier-edge"));
      }
      pipelineY += 145;
    }

    const allocationId = `allocation:${group.id}`;
    nodes.push(node(allocationId, x, pipelineY, "Equal allocation", group.choose ? "Selected assets receive equal target weights" : "Universe assets receive equal target weights",
      semanticSelection(projection.split ? "split" : "group", projection.split ? projection.portfolioComponentId ?? null : group.allocationComponentId ?? null, { groupId: group.id }),
      "allocation", "allocation"));
    edges.push(edge(pipeline, allocationId, group.choose ? "selected candidates" : "assets"));

    const actionId = `action:${group.id}`;
    nodes.push(node(actionId, x, pipelineY + 135, "Rebalance", "Action · apply the portfolio targets",
      semanticSelection("rule", projection.predicate?.componentId ?? group.sleeveComponentId ?? group.allocationComponentId ?? null, { groupId: group.id }),
      "action", "action"));
    edges.push(edge(allocationId, actionId, "portfolio targets"));

    if (group.scheduleComponentId) {
      const scheduleId = `schedule:${group.id}`;
      nodes.push(node(scheduleId, x - 245, baseY, "Schedule", group.timing ?? "Independent schedule",
        semanticSelection("schedule", group.scheduleComponentId, { groupId: group.id }), "schedule", "schedule"));
      edges.push(edge(scheduleId, groupId, "evaluates", "strategy-flow-edge timing-edge"));
    }
  });

  if (projection.rebalanceScheduleComponentId) {
    const id = "schedule:portfolio";
    nodes.push(node(id, 120, 20, "Portfolio schedule", projection.rebalance ?? "Schedule",
      semanticSelection("schedule", projection.rebalanceScheduleComponentId), "schedule", "schedule"));
    edges.push(edge(id, rootId, "evaluates", "strategy-flow-edge timing-edge"));
  }

  if (projection.predicate) {
    const predicateId = "predicate";
    nodes.push(node(predicateId, 810, 20, "Market route", projection.predicate.label,
      semanticSelection("rule", projection.predicate.componentId, { fieldPath: "condition" }), "predicate", "predicate"));
    const thenId = "predicate:then";
    nodes.push(node(thenId, 700, 175, "True route", projection.predicate.thenTarget ?? "Portfolio targets",
      semanticSelection("rule", projection.predicate.componentId, { fieldPath: "actions[0]" }), "branch", "growth"));
    edges.push(edge(predicateId, thenId, "true", "strategy-flow-edge true-route", "true"));
    edges.push(edge(thenId, rootId, "target"));
    if (projection.predicate.otherwiseTarget) {
      const otherwiseId = "predicate:otherwise";
      nodes.push(node(otherwiseId, 930, 175, "False route", projection.predicate.otherwiseTarget,
        semanticSelection("rule", projection.predicate.componentId, { fieldPath: "else_actions[0]" }), "branch", "defensive"));
      edges.push(edge(predicateId, otherwiseId, "false", "strategy-flow-edge false-route", "false"));
      edges.push(edge(otherwiseId, rootId, "target"));
    } else {
      nodes.push(node("predicate:retain", 930, 175, "False route", "Retain current holdings · no branch mutation",
        semanticSelection("rule", projection.predicate.componentId, { fieldPath: "condition" }), "branch", "defensive"));
      edges.push(edge(predicateId, "predicate:retain", "false", "strategy-flow-edge false-route", "false"));
    }
  }
  return { nodes, edges };
}

export function flowNodeIdForSelection(nodes: SemanticNode[], selection: SemanticSelection | null): string | null {
  if (!selection?.componentId) return null;
  const matching = nodes.filter((item) => item.data.selection.componentId === selection.componentId);
  return (matching.find((item) => item.data.selection.fieldPath === selection.fieldPath) ?? matching[0])?.id ?? null;
}

const inertStructural: StructuralAuthoringController = { capabilities: null, status: "ready", error: null, apply: async () => false, compose: async () => false };

export function FlowView({ structural = inertStructural }: { structural?: StructuralAuthoringController }) {
  const { state, dispatch } = useStrategyEditor();
  const projection = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const graph = useMemo(() => projectFlowCanvas(projection), [projection]);
  const options = useMemo(() => constructionOptions(projection, structural.capabilities, state.editor.selection), [projection, structural.capabilities, state.editor.selection]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SemanticNode>(graph.nodes);
  const [pendingOption, setPendingOption] = useState<ConstructionOption | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);

  useEffect(() => setNodes((current) => mergeFlowNodePositions(graph.nodes, current)), [graph.nodes, setNodes]);

  const displayed = nodes.map((item) => ({ ...item, selected: sameSemanticSelection(item.data.selection, state.editor.selection) }));
  const draftConnection = state.editor.flowDraft.connection;
  const edges = draftConnection && nodes.some((item) => item.id === draftConnection.sourceId) && nodes.some((item) => item.id === draftConnection.targetId)
    ? [...graph.edges, edge(draftConnection.sourceId, draftConnection.targetId, "draft relationship", "strategy-flow-edge draft-edge", draftConnection.sourceHandle ?? undefined)]
    : graph.edges;

  const removeSelected = useCallback(() => {
    const operation = semanticDeleteOperation(state.editor.selection, structural.capabilities);
    if (operation) void structural.apply(operation, null);
    else setConnectionNotice("This semantic unit cannot be removed safely in Flow. Use its Inspector or resolve the surrounding topology.");
  }, [state.editor.selection, structural]);

  const beginDraft = (option: ConstructionOption) => {
    setPendingOption(option);
    dispatch({ type: "begin_flow_draft", intent: {
      kind: option.kind, targetComponentId: option.targetComponentId,
      targetLabel: option.targetLabel, groupId: option.groupId,
    } });
  };
  const applyDraft = async (operation: () => Promise<boolean>) => {
    dispatch({ type: "set_flow_draft_status", status: "commit_ready", message: "Applying the complete Flow change…" });
    const ok = await operation();
    if (ok) {
      setPendingOption(null);
      dispatch({ type: "clear_flow_draft" });
    } else {
      dispatch({ type: "set_flow_draft_status", status: "incomplete", message: "The backend rejected this Flow change. The committed Strategy is unchanged." });
    }
    return ok;
  };

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      const intent = JSON.parse(event.dataTransfer.getData("application/x-ruletrade-concept")) as { kind: string; targetComponentId: string };
      const option = options.find((item) => item.kind === intent.kind && item.targetComponentId === intent.targetComponentId);
      if (!option) return;
      dispatch({ type: "select_semantic", selection: option.anchorSelection });
      beginDraft(option);
      if (option.kind === "qualification") {
        const operation = insertConditionBeforeRank(state.canonical, option.targetComponentId);
        if (operation) void applyDraft(() => structural.compose(operation, (result) =>
          semanticSelection("qualification", result.created_component_ids.condition ?? null, { fieldPath: "config.threshold", groupId: option.groupId })));
      }
    } catch {
      setConnectionNotice("That drop did not contain a RuleTrade semantic concept.");
    }
  }, [dispatch, options, state.canonical, structural]);

  const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
  const isValidConnection = useCallback((connection: Connection) => {
    const source = connection.source ? nodeById.get(connection.source)?.data.semanticKind : undefined;
    const target = connection.target ? nodeById.get(connection.target)?.data.semanticKind : undefined;
    return Boolean(source && target && isCompatibleFlowConnection(source, target));
  }, [nodeById]);
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const sourceKind = nodeById.get(connection.source)?.data.semanticKind;
    const targetKind = nodeById.get(connection.target)?.data.semanticKind;
    if (!sourceKind || !targetKind || !isCompatibleFlowConnection(sourceKind, targetKind)) return;
    dispatch({
      type: "set_flow_draft_connection",
      status: "valid_but_unsupported",
      connection: {
        sourceId: connection.source, targetId: connection.target, sourceKind, targetKind,
        sourceHandle: connection.sourceHandle,
      },
      message: "This relationship is semantically meaningful, but direct rewiring is not yet an unambiguous backend operation. Discard it or use a supported toolbox scaffold.",
    });
  }, [dispatch, nodeById]);

  const draftActive = state.editor.flowDraft.status !== "clean";
  return <div className="flow-representation" tabIndex={0} data-flow-draft-status={state.editor.flowDraft.status}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-ruletrade-concept")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
    onDrop={onDrop}
    onKeyDown={(event) => {
      if (event.key === "Escape") dispatch({ type: "select_semantic", selection: null });
      if ((event.key === "Delete" || event.key === "Backspace") && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) removeSelected();
    }}>
    <ReactFlow<SemanticNode, Edge>
      nodes={displayed} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, selected) => dispatch({ type: "select_semantic", selection: selected.data.selection })}
      onPaneClick={() => dispatch({ type: "select_semantic", selection: null })}
      nodesConnectable onConnect={onConnect} isValidConnection={isValidConnection}
      deleteKeyCode={null} fitView fitViewOptions={{ padding: .2 }} minZoom={.35} maxZoom={1.8}>
      <Background gap={24} size={1} /><Controls showInteractive={false} />
    </ReactFlow>
    <div className="flow-canvas-hint">Click to inspect · drag to arrange · connect only semantic handles · pan/zoom remain presentation-only</div>
    {options.length > 0 && <div className="flow-add-hint">Drag an available capital-flow concept from Add onto a compatible Strategy location.</div>}
    {connectionNotice && <div className="flow-connection-notice" role="status">{connectionNotice}<button onClick={() => setConnectionNotice(null)} aria-label="Dismiss Flow notice">×</button></div>}
    {draftActive && <div className={`flow-draft-status ${state.editor.flowDraft.status}`} role="status">
      <strong>{state.editor.flowDraft.status === "incomplete" ? "Unfinished Flow change" : state.editor.flowDraft.status === "valid_but_unsupported" ? "Supported meaning, unavailable commit" : "Applying Flow change"}</strong>
      <span>{state.editor.flowDraft.message}</span>
      <button className="text-button" onClick={() => { setPendingOption(null); dispatch({ type: "clear_flow_draft" }); }}>Discard Flow draft</button>
    </div>}
    {pendingOption && pendingOption.kind !== "qualification" && <div className="flow-actions" aria-label="Pending Flow construction">
      {pendingOption.kind === "metric" && <MetricConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => applyDraft(async () => {
        const operation = composeRankedSelectionPipeline(state.canonical, pendingOption.targetComponentId, lookback, count);
        return operation ? structural.compose(operation, (result) => semanticSelection("rule", result.created_component_ids.metric ?? null, { fieldPath: "config.lookback_bars", groupId: pendingOption.groupId })) : false;
      })} />}
      {pendingOption.kind === "choose" && <ChooseTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => applyDraft(() => structural.apply({
        kind: "transform_to_choose_assets", weight_component_id: pendingOption.targetComponentId, lookback_observations: lookback, count,
      }, semanticSelection("selection", `${pendingOption.targetComponentId}_top_n`, { groupId: pendingOption.groupId })))} />}
      {pendingOption.kind === "fallback" && <FallbackTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(asset) => applyDraft(() => structural.apply({
        kind: "add_fallback_selection", weight_component_id: pendingOption.targetComponentId, fallback_asset: asset,
      }, semanticSelection("fallback", `${pendingOption.targetComponentId}_fallback`, { groupId: pendingOption.groupId })))} />}
      {pendingOption.kind === "cooldown" && <CooldownConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(duration) => applyDraft(() => structural.apply({
        kind: "add_cooldown_to_selection", selection_component_id: pendingOption.targetComponentId, duration,
      }, semanticSelection("cooldown", `${pendingOption.targetComponentId}_cooldown`, { fieldPath: "config.duration", groupId: pendingOption.groupId })))} />}
      {pendingOption.kind === "split" && <GrowthDefensiveTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(allocation, assets) => applyDraft(async () => {
        const operation = composeTwoSleevePortfolio(state.canonical, pendingOption.targetComponentId, allocation, assets);
        return operation ? structural.compose(operation, (result) => semanticSelection("split", result.created_component_ids.portfolio ?? null)) : false;
      })} />}
      <button className="text-button" onClick={() => { setPendingOption(null); dispatch({ type: "clear_flow_draft" }); }}>Cancel</button>
    </div>}
  </div>;
}
