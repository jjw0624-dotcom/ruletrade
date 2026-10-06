import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { constructionOptions, semanticDeleteOperation, type ConstructionOption } from "../domain/builderProjection";
import { composeRankedSelectionPipeline, insertConditionBeforeRank } from "../domain/compositionIntents";
import { dispatchSplitConstruction } from "../domain/constructionDispatch";
import { projectConceptualFlow, type ConceptualGroup } from "../domain/conceptualFlow";
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

export type FlowVisualRole = "capital" | "routing" | "decision-detail" | "timing" | "constraint" | "action";
export type FlowRelationshipRole = "capital" | "routing" | "decision-detail" | "timing" | "constraint" | "action";

export type SemanticNodeData = Record<string, unknown> & {
  title: string;
  detail: string;
  tone?: string;
  selection: SemanticSelection;
  semanticKind: FlowSemanticKind;
  visualRole: FlowVisualRole;
};
export type SemanticNode = Node<SemanticNodeData, "semantic">;
export type SemanticEdge = Edge<{ role: FlowRelationshipRole }>;

function SemanticFlowNode({ data, selected }: NodeProps<SemanticNode>) {
  const hasTarget = data.semanticKind !== "portfolio" && data.semanticKind !== "schedule";
  const hasSource = !["action", "constraint"].includes(data.semanticKind);
  return <div className={`semantic-flow-node flow-role-${data.visualRole} ${data.tone ?? ""}${selected ? " selected" : ""}`}
    role="button" tabIndex={0} aria-label={`${data.title}: ${data.detail}`}
    data-semantic-kind={data.semanticKind} data-flow-role={data.visualRole}>
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
  selection: SemanticSelection, semanticKind: FlowSemanticKind, visualRole: FlowVisualRole, tone?: string,
): SemanticNode => ({
  id, type: "semantic", position: { x, y },
  data: { title, detail, selection, semanticKind, visualRole, tone },
});

const edge = (
  source: string, target: string, role: FlowRelationshipRole,
  label?: string, sourceHandle?: string,
): SemanticEdge => {
  const carriesCapital = role === "capital" || role === "routing" || role === "action";
  return {
    id: `${source}-${target}-${sourceHandle ?? ""}-${role}-${label ?? ""}`,
    source, target, sourceHandle, label, type: "smoothstep",
    markerEnd: carriesCapital ? { type: MarkerType.ArrowClosed } : undefined,
    className: `strategy-flow-edge flow-edge-${role}`,
    data: { role },
  };
};

export function mergeFlowNodePositions(projected: SemanticNode[], current: SemanticNode[]): SemanticNode[] {
  const positions = new Map(current.map((item) => [item.id, item.position]));
  return projected.map((item) => ({ ...item, position: positions.get(item.id) ?? item.position }));
}

function groupOwnsTarget(group: ConceptualGroup, target: string | undefined): boolean {
  if (!target) return false;
  return group.sourceComponentIds.includes(target)
    || group.sleeveComponentId === target
    || group.universeComponentId === target
    || group.allocationComponentId === target;
}

function targetDetail(target: string): string {
  return target.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function projectFlowCanvas(projection: ReturnType<typeof projectConceptualFlow>) {
  const nodes: SemanticNode[] = [];
  const edges: SemanticEdge[] = [];
  const rootId = "portfolio";
  const centerX = 520;

  if (projection.unsupportedReason) {
    nodes.push(node(rootId, centerX, 30, "Unsupported strategy shape", projection.unsupportedReason,
      semanticSelection("portfolio", null), "portfolio", "capital"));
    return { nodes, edges };
  }

  nodes.push(node(rootId, centerX, 30, projection.title,
    projection.kind === "portfolio" ? "Portfolio capital" : "Portfolio capital · 100%",
    semanticSelection("portfolio", projection.portfolioComponentId ?? null), "portfolio", "capital", "portfolio"));

  const predicate = projection.predicate;
  const predicateId = "predicate";
  if (predicate) {
    nodes.push(node(predicateId, centerX, 180, "Capital route", predicate.label,
      semanticSelection("rule", predicate.componentId, { fieldPath: "condition" }), "predicate", "routing", "predicate"));
    edges.push(edge(rootId, predicateId, "capital"));
  }

  let splitId: string | null = null;
  if (projection.split && !predicate) {
    splitId = "split";
    nodes.push(node(splitId, centerX, 180, "Split capital",
      projection.groups.map((group) => group.allocation).join(" / "),
      semanticSelection("split", projection.portfolioComponentId ?? null), "allocation", "routing", "split"));
    edges.push(edge(rootId, splitId, "capital"));
  }

  const thenMatch = predicate
    ? projection.groups.findIndex((group) => groupOwnsTarget(group, predicate.thenTarget))
    : -1;
  const otherwiseMatch = predicate?.otherwiseTarget
    ? projection.groups.findIndex((group) => groupOwnsTarget(group, predicate.otherwiseTarget))
    : -1;
  const thenIndex = predicate ? (thenMatch >= 0 ? thenMatch : 0) : -1;
  const otherwiseIndex = predicate?.otherwiseTarget
    ? (otherwiseMatch >= 0 ? otherwiseMatch : projection.groups.length > 1 ? 1 : -1)
    : -1;

  const groupGap = 520;
  const groupStartX = centerX - ((projection.groups.length - 1) * groupGap) / 2;
  const groupBaseY = predicate || splitId ? 350 : 200;

  projection.groups.forEach((group, index) => {
    const x = groupStartX + index * groupGap;
    const groupId = `group:${group.id}`;
    nodes.push(node(groupId, x, groupBaseY, group.label,
      group.allocation ? `${group.allocation} capital exposure` : "Investment exposure",
      semanticSelection("group", group.sleeveComponentId ?? group.universeComponentId ?? null, { groupId: group.id }),
      "group", "capital", index ? "defensive" : "growth"));

    if (predicate) {
      if (index === thenIndex) edges.push(edge(predicateId, groupId, "routing", "true", "true"));
      if (predicate.otherwiseTarget && index === otherwiseIndex) {
        edges.push(edge(predicateId, groupId, "routing", "false", "false"));
      }
    } else {
      edges.push(edge(splitId ?? rootId, groupId, splitId ? "routing" : "capital", group.allocation ?? "100%"));
    }

    const universeId = `universe:${group.id}`;
    const choose = group.choose;

    if (choose) {
      const selectionY = groupBaseY + 175;
      const selectionId = `selection:${group.id}`;
      const selectionDetail = [
        `from ${group.assets.length} asset${group.assets.length === 1 ? "" : "s"}`,
        choose.condition ? "1 eligibility filter" : "no eligibility filter",
        choose.ranking ? `ranked by ${choose.ranking}` : null,
      ].filter(Boolean).join(" · ");
      nodes.push(node(selectionId, x, selectionY, choose.label, selectionDetail,
        semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }),
        "selection", "routing", "selection"));
      edges.push(edge(groupId, selectionId, "capital"));

      nodes.push(node(universeId, x - 300, selectionY - 70, "Selection universe",
        `${group.universeLabel ?? "Explicit universe"} · ${group.assets.join(" · ")}`,
        semanticSelection("universe", group.universeComponentId ?? null, { groupId: group.id }),
        "universe", "decision-detail", "universe"));
      edges.push(edge(universeId, selectionId, "decision-detail", "FROM"));

      if (choose.filterComponentId) {
        const eligibilityId = `qualification:${group.id}`;
        nodes.push(node(eligibilityId, x - 300, selectionY + 65, "Eligibility",
          choose.condition ?? "Supported eligibility",
          semanticSelection("qualification", choose.filterComponentId, {
            fieldPath: choose.eligibilityFieldPath ?? "config.threshold", groupId: group.id,
          }), "eligibility", "decision-detail", "qualification"));
        edges.push(edge(eligibilityId, selectionId, "decision-detail", "WHERE"));
      }

      if (choose.cooldownComponentId) {
        const cooldownId = `cooldown:${group.id}`;
        nodes.push(node(cooldownId, x + 300, selectionY - 55, "Selection constraint",
          choose.cooldown ?? "Cooldown",
          semanticSelection("cooldown", choose.cooldownComponentId, {
            fieldPath: "config.duration", groupId: group.id,
          }), "constraint", "constraint", "constraint"));
        edges.push(edge(cooldownId, selectionId, "constraint"));
      }

      const selectedX = choose.fallbackComponentId ? x - 120 : x;
      const selectedId = `selected-target:${group.id}`;
      const routeY = selectionY + 180;
      nodes.push(node(selectedId, selectedX, routeY, "Selected target basket",
        choose.ranking ? choose.ranking : "Selection result exposure",
        semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }),
        "exposure", "capital", "selected-target"));
      edges.push(edge(selectionId, selectedId, "routing", "selection succeeds"));

      const allocationId = `allocation:${group.id}`;
      nodes.push(node(allocationId, selectedX, routeY + 165, "Equal allocation",
        "Selected assets receive equal target weights",
        semanticSelection(projection.split ? "split" : "group",
          projection.split ? projection.portfolioComponentId ?? null : group.allocationComponentId ?? null,
          { groupId: group.id }), "allocation", "capital", "allocation"));
      edges.push(edge(selectedId, allocationId, "capital", "equal weight"));

      const targetId = `portfolio-target:${group.id}`;
      nodes.push(node(targetId, x, routeY + 330, "Portfolio target",
        group.allocation ? `${group.allocation} sleeve target` : "Target exposure",
        semanticSelection("group", group.allocationComponentId ?? group.sleeveComponentId ?? null, { groupId: group.id }),
        "target", "capital", "target"));
      edges.push(edge(allocationId, targetId, "capital"));

      if (choose.fallbackComponentId) {
        const fallbackId = `fallback:${group.id}`;
        const destination = choose.otherwise?.replace(/^Otherwise\s*→\s*/i, "") ?? "Fallback exposure";
        nodes.push(node(fallbackId, x + 260, routeY, "Fallback exposure", destination,
          semanticSelection("fallback", choose.fallbackComponentId, { groupId: group.id }),
          "fallback", "capital", "fallback"));
        edges.push(edge(selectionId, fallbackId, "routing", "if incomplete"));
        edges.push(edge(fallbackId, targetId, "capital", "fallback target"));
      }

      const actionId = `action:${group.id}`;
      nodes.push(node(actionId, x, routeY + 485, "Rebalance", "Action · realize the portfolio target",
        semanticSelection("rule", predicate?.componentId ?? group.sleeveComponentId ?? group.allocationComponentId ?? null,
          { groupId: group.id }), "action", "action", "action"));
      edges.push(edge(targetId, actionId, "action", "realizes target"));

      if (group.scheduleComponentId) {
        const scheduleId = `schedule:${group.id}`;
        nodes.push(node(scheduleId, x - 250, groupBaseY - 20, "Schedule",
          group.timing ?? "Independent schedule",
          semanticSelection("schedule", group.scheduleComponentId, { groupId: group.id }),
          "schedule", "timing", "schedule"));
        edges.push(edge(scheduleId, selectionId, "timing", "evaluates"));
      }
    } else {
      const allocationY = groupBaseY + 190;
      nodes.push(node(universeId, x - 285, allocationY, "Asset universe",
        `${group.universeLabel ?? "Explicit universe"} · ${group.assets.join(" · ")}`,
        semanticSelection("universe", group.universeComponentId ?? null, { groupId: group.id }),
        "universe", "decision-detail", "universe"));

      const allocationId = `allocation:${group.id}`;
      nodes.push(node(allocationId, x, allocationY, "Equal allocation",
        "Universe assets receive equal target weights",
        semanticSelection(projection.split ? "split" : "group",
          projection.split ? projection.portfolioComponentId ?? null : group.allocationComponentId ?? null,
          { groupId: group.id }), "allocation", "capital", "allocation"));
      edges.push(edge(groupId, allocationId, "capital", "equal weight"));
      edges.push(edge(universeId, allocationId, "decision-detail", "assets"));

      const targetId = `portfolio-target:${group.id}`;
      nodes.push(node(targetId, x, allocationY + 170, "Portfolio target",
        group.allocation ? `${group.allocation} sleeve target` : "Target exposure",
        semanticSelection("group", group.allocationComponentId ?? group.sleeveComponentId ?? null, { groupId: group.id }),
        "target", "capital", "target"));
      edges.push(edge(allocationId, targetId, "capital"));

      const actionId = `action:${group.id}`;
      nodes.push(node(actionId, x, allocationY + 325, "Rebalance", "Action · realize the portfolio target",
        semanticSelection("rule", predicate?.componentId ?? group.sleeveComponentId ?? group.allocationComponentId ?? null,
          { groupId: group.id }), "action", "action", "action"));
      edges.push(edge(targetId, actionId, "action", "realizes target"));

      if (group.scheduleComponentId) {
        const scheduleId = `schedule:${group.id}`;
        nodes.push(node(scheduleId, x - 250, groupBaseY - 20, "Schedule",
          group.timing ?? "Independent schedule",
          semanticSelection("schedule", group.scheduleComponentId, { groupId: group.id }),
          "schedule", "timing", "schedule"));
        edges.push(edge(scheduleId, allocationId, "timing", "evaluates"));
      }
    }
  });

  if (predicate) {
    if (thenIndex < 0) {
      const thenId = "predicate:then";
      nodes.push(node(thenId, centerX - 210, groupBaseY, "True-route exposure",
        predicate.thenTarget ? targetDetail(predicate.thenTarget) : "Portfolio target",
        semanticSelection("rule", predicate.componentId, { fieldPath: "actions[0]" }),
        "exposure", "capital", "growth"));
      edges.push(edge(predicateId, thenId, "routing", "true", "true"));
    }
    if (predicate.otherwiseTarget && otherwiseIndex < 0) {
      const otherwiseId = "predicate:otherwise";
      nodes.push(node(otherwiseId, centerX + 210, groupBaseY, "False-route exposure",
        targetDetail(predicate.otherwiseTarget),
        semanticSelection("rule", predicate.componentId, { fieldPath: "else_actions[0]" }),
        "exposure", "capital", "defensive"));
      edges.push(edge(predicateId, otherwiseId, "routing", "false", "false"));
    } else if (!predicate.otherwiseTarget) {
      const retainId = "predicate:retain";
      nodes.push(node(retainId, centerX + 260, groupBaseY, "Retain holdings",
        "False route · keep current exposure · no branch mutation",
        semanticSelection("rule", predicate.componentId, { fieldPath: "condition" }),
        "exposure", "capital", "defensive"));
      edges.push(edge(predicateId, retainId, "routing", "false · retain holdings", "false"));
    }
  }

  if (projection.rebalanceScheduleComponentId) {
    const scheduleId = "schedule:portfolio";
    const targetId = predicate ? predicateId : splitId ?? rootId;
    nodes.push(node(scheduleId, 120, 30, "Portfolio schedule",
      projection.rebalance ?? "Schedule",
      semanticSelection("schedule", projection.rebalanceScheduleComponentId),
      "schedule", "timing", "schedule"));
    edges.push(edge(scheduleId, targetId, "timing", "evaluates"));
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
    ? [...graph.edges, edge(draftConnection.sourceId, draftConnection.targetId, "decision-detail", "draft relationship", draftConnection.sourceHandle ?? undefined)]
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
  const isValidConnection = useCallback((connection: Connection | Edge) => {
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
      deleteKeyCode={null} fitView fitViewOptions={{ padding: .16, maxZoom: 1.05 }} minZoom={.35} maxZoom={1.8}>
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
      {pendingOption.kind === "split" && <GrowthDefensiveTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(allocation, assets) => applyDraft(() => dispatchSplitConstruction(pendingOption, structural, allocation, assets))} />}
      <button className="text-button" onClick={() => { setPendingOption(null); dispatch({ type: "clear_flow_draft" }); }}>Cancel</button>
    </div>}
  </div>;
}
