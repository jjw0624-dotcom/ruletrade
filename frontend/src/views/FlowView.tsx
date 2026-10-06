import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState,
  type Connection, type Edge, type Node, type NodeChange, type NodeProps,
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
  provenance?: SemanticSelection[];
  badges?: string[];
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
    {data.badges && data.badges.length > 0 && <div className="flow-node-badges">{data.badges.map((badge) => <small key={badge}>{badge}</small>)}</div>}
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
  deletable: false,
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
    deletable: role === "decision-detail",
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

export function projectProductionFlowCanvas(projection: ReturnType<typeof projectConceptualFlow>) {
  const nodes: SemanticNode[] = [];
  const edges: SemanticEdge[] = [];
  const rootId = "portfolio";
  const centerX = 560;
  const decorate = (item: SemanticNode, provenance: SemanticSelection[] = [], badges: string[] = []) => {
    item.data.provenance = provenance.filter((address) => Boolean(address.componentId));
    item.data.badges = badges;
    return item;
  };
  const selectionProvenance = (group: ConceptualGroup): SemanticSelection[] => {
    const choose = group.choose;
    if (!choose) return [semanticSelection("universe", group.universeComponentId ?? null, { groupId: group.id })];
    return [
      semanticSelection("universe", group.universeComponentId ?? null, { groupId: group.id }),
      ...(choose.filterComponentId ? [semanticSelection("qualification", choose.filterComponentId, {
        fieldPath: choose.eligibilityFieldPath ?? "condition", groupId: group.id,
      })] : []),
      ...(choose.cooldownComponentId ? [semanticSelection("cooldown", choose.cooldownComponentId, {
        fieldPath: "config.duration", groupId: group.id,
      })] : []),
      ...(group.scheduleComponentId ? [semanticSelection("schedule", group.scheduleComponentId, { groupId: group.id })] : []),
    ];
  };
  const groupBadges = (group: ConceptualGroup) => [
    ...(group.timing ? [group.timing] : []),
    ...(group.choose?.cooldown ? [group.choose.cooldown] : []),
  ];

  if (projection.unsupportedReason) {
    nodes.push(node(rootId, centerX, 40, "Unsupported strategy shape", projection.unsupportedReason,
      semanticSelection("portfolio", null), "portfolio", "capital"));
    return { nodes, edges };
  }

  const root = node(rootId, centerX, 40, projection.title,
    projection.kind === "portfolio" ? "Portfolio capital" : "Capital · 100%",
    semanticSelection("portfolio", projection.portfolioComponentId ?? null), "portfolio", "capital", "portfolio");
  if (projection.rebalanceScheduleComponentId) {
    root.data.provenance = [semanticSelection("schedule", projection.rebalanceScheduleComponentId)];
    root.data.badges = [projection.rebalance ?? "Scheduled"];
  }
  nodes.push(root);

  const predicate = projection.predicate;
  const predicateId = "predicate";
  if (predicate) {
    nodes.push(node(predicateId, centerX, 180, predicate.label, "Capital routing condition",
      semanticSelection("rule", predicate.componentId, { fieldPath: "condition" }), "predicate", "routing", "predicate"));
    edges.push(edge(rootId, predicateId, "capital"));
  }

  let splitId: string | null = null;
  if (projection.split && !predicate) {
    splitId = "split";
    nodes.push(node(splitId, centerX, 180, "Split",
      projection.groups.map((group) => group.allocation).join(" / "),
      semanticSelection("split", projection.portfolioComponentId ?? null), "allocation", "routing", "split"));
    edges.push(edge(rootId, splitId, "capital"));
  }

  const thenMatch = predicate ? projection.groups.findIndex((group) => groupOwnsTarget(group, predicate.thenTarget)) : -1;
  const otherwiseMatch = predicate?.otherwiseTarget ? projection.groups.findIndex((group) => groupOwnsTarget(group, predicate.otherwiseTarget)) : -1;
  const thenIndex = predicate ? (thenMatch >= 0 ? thenMatch : 0) : -1;
  const otherwiseIndex = predicate?.otherwiseTarget ? (otherwiseMatch >= 0 ? otherwiseMatch : projection.groups.length > 1 ? 1 : -1) : -1;
  const groupGap = projection.groups.length > 1 ? 560 : 0;
  const groupStartX = centerX - ((projection.groups.length - 1) * groupGap) / 2;
  const groupBaseY = predicate || splitId ? 345 : 205;
  const actionSources: Array<{ id: string; label: string }> = [];

  projection.groups.forEach((group, index) => {
    const x = groupStartX + index * groupGap;
    const groupId = `group:${group.id}`;
    nodes.push(decorate(node(groupId, x, groupBaseY, group.label,
      group.allocation ? "Capital sleeve" : "Investment",
      semanticSelection("group", group.sleeveComponentId ?? group.universeComponentId ?? null, { groupId: group.id }),
      "group", "capital", index ? "defensive" : "growth"), [], groupBadges(group)));

    if (predicate) {
      if (index === thenIndex) edges.push(edge(predicateId, groupId, "routing", "true", "true"));
      if (predicate.otherwiseTarget && index === otherwiseIndex) edges.push(edge(predicateId, groupId, "routing", "false", "false"));
    } else {
      edges.push(edge(splitId ?? rootId, groupId, splitId ? "routing" : "capital", group.allocation ?? "100%"));
    }

    const choose = group.choose;
    const destinationY = groupBaseY + 175;
    if (choose?.fallbackComponentId) {
      const selectionId = `selection:${group.id}`;
      const shortRanking = choose.ranking?.replace(/^Candidate['’]s\s*/i, "") ?? "configured ranking";
      const summary = [choose.condition ? "1 filter" : null, `highest ${shortRanking}`].filter(Boolean).join(" · ");
      nodes.push(decorate(node(selectionId, x, destinationY, choose.label, summary,
        semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }),
        "selection", "routing", "selection"), selectionProvenance(group), groupBadges(group)));
      edges.push(edge(groupId, selectionId, "capital"));

      const selectedId = `selected-target:${group.id}`;
      nodes.push(decorate(node(selectedId, x - 175, destinationY + 175, "Selected assets", "Target exposure",
        semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }),
        "exposure", "capital", "selected-target"), selectionProvenance(group)));
      edges.push(edge(selectionId, selectedId, "routing", "selected · equal weight"));
      actionSources.push({ id: selectedId, label: "selected target" });

      const fallbackId = `fallback:${group.id}`;
      const destination = choose.otherwise?.replace(/^Otherwise\s*→\s*/i, "") ?? "Fallback asset";
      nodes.push(node(fallbackId, x + 175, destinationY + 175, destination, "Fallback exposure",
        semanticSelection("fallback", choose.fallbackComponentId, { groupId: group.id }),
        "fallback", "capital", "fallback"));
      edges.push(edge(selectionId, fallbackId, "routing", "if incomplete"));
      actionSources.push({ id: fallbackId, label: "fallback target" });
    } else if (choose) {
      const selectedId = `selected-target:${group.id}`;
      const shortRanking = choose.ranking?.replace(/^Candidate['’]s\s*/i, "") ?? "configured ranking";
      nodes.push(decorate(node(selectedId, x, destinationY, "Selected assets",
        `${choose.label} · equal weight`,
        semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }),
        "exposure", "capital", "selected-target"), selectionProvenance(group), [
          ...(choose.condition ? ["1 eligibility filter"] : []),
          `highest ${shortRanking}`,
          ...groupBadges(group),
        ]));
      edges.push(edge(groupId, selectedId, "capital", "selected · equal weight"));
      actionSources.push({ id: selectedId, label: group.allocation ? `${group.allocation} target` : "selected target" });
    } else {
      const exposureId = `asset-target:${group.id}`;
      const title = group.assets.length === 1 ? group.assets[0] : "Asset basket";
      nodes.push(decorate(node(exposureId, x, destinationY, title,
        `${group.assets.length} asset${group.assets.length === 1 ? "" : "s"} · equal weight`,
        semanticSelection("group", group.allocationComponentId ?? group.universeComponentId ?? null, { groupId: group.id }),
        "exposure", "capital", "asset-target"), selectionProvenance(group), groupBadges(group)));
      edges.push(edge(groupId, exposureId, "capital", "equal weight"));
      actionSources.push({ id: exposureId, label: group.allocation ? `${group.allocation} target` : "target exposure" });
    }
  });

  const actionId = "action:portfolio";
  const deepestY = projection.groups.some((group) => group.choose?.fallbackComponentId)
    ? groupBaseY + 555 : groupBaseY + 385;
  nodes.push(node(actionId, centerX, deepestY, "Rebalance", "Realize target exposure",
    semanticSelection("rule", predicate?.componentId ?? projection.portfolioComponentId ?? null),
    "action", "action", "action"));
  actionSources.forEach(({ id, label }) => edges.push(edge(id, actionId, "action", label)));

  if (predicate) {
    if (thenIndex < 0) {
      const thenId = "predicate:then";
      nodes.push(node(thenId, centerX - 230, groupBaseY, "True exposure",
        predicate.thenTarget ? targetDetail(predicate.thenTarget) : "Portfolio target",
        semanticSelection("rule", predicate.componentId, { fieldPath: "actions[0]" }),
        "exposure", "capital", "growth"));
      edges.push(edge(predicateId, thenId, "routing", "true", "true"));
    }
    if (predicate.otherwiseTarget && otherwiseIndex < 0) {
      const otherwiseId = "predicate:otherwise";
      nodes.push(node(otherwiseId, centerX + 230, groupBaseY, "False exposure",
        targetDetail(predicate.otherwiseTarget),
        semanticSelection("rule", predicate.componentId, { fieldPath: "else_actions[0]" }),
        "exposure", "capital", "defensive"));
      edges.push(edge(predicateId, otherwiseId, "routing", "false", "false"));
    } else if (!predicate.otherwiseTarget) {
      const retainId = "predicate:retain";
      nodes.push(node(retainId, centerX + 250, groupBaseY, "Retain holdings",
        "Keep current exposure",
        semanticSelection("rule", predicate.componentId, { fieldPath: "condition" }),
        "exposure", "capital", "defensive"));
      edges.push(edge(predicateId, retainId, "routing", "false · retain holdings", "false"));
    }
  }

  return { nodes, edges };
}

// Compatibility export for projection-level tests. The production projection itself is
// concise; no post-projection label blacklist or node hiding is applied.
export const projectFlowCanvas = projectProductionFlowCanvas;

export function productionFlowNodeManifest(nodes: SemanticNode[]): string {
  return nodes.map((item) => `${item.id}|${item.data.semanticKind}|${item.data.title}`).join(";");
}

export function flowNodeIdForSelection(nodes: SemanticNode[], selection: SemanticSelection | null): string | null {
  if (!selection?.componentId) return null;
  const matching = nodes.filter((item) => item.data.selection.componentId === selection.componentId
    || item.data.provenance?.some((address) => address.componentId === selection.componentId));
  return (matching.find((item) => item.data.selection.fieldPath === selection.fieldPath
    || item.data.provenance?.some((address) => address.fieldPath === selection.fieldPath)) ?? matching[0])?.id ?? null;
}

export function flowDraftSemanticKind(option: ConstructionOption): FlowSemanticKind {
  if (option.kind === "split") return "allocation";
  if (option.kind === "fallback") return "fallback";
  if (option.kind === "cooldown") return "constraint";
  return "selection";
}

export function createFlowDraftNode(option: ConstructionOption, position = { x: 340, y: 240 }): SemanticNode {
  const semanticKind = flowDraftSemanticKind(option);
  const visualRole: FlowVisualRole = option.kind === "split" || option.kind === "choose" || option.kind === "metric"
    ? "routing" : option.kind === "cooldown" ? "constraint" : "decision-detail";
  return {
    ...node(`draft:${option.kind}:${option.targetComponentId}`, position.x, position.y,
      option.kind === "choose" ? "Selection" : option.label,
      `Unfinished · connect to ${option.targetLabel}`,
      option.anchorSelection, semanticKind, visualRole, "draft"),
    deletable: true,
  };
}

export function isCommitReadyFlowConnection(option: ConstructionOption, source: FlowSemanticKind, target: FlowSemanticKind): boolean {
  return option.kind === "split" && source === "portfolio" && target === "allocation";
}

const inertStructural: StructuralAuthoringController = { capabilities: null, status: "ready", error: null, apply: async () => false, compose: async () => false };

export function FlowView({ structural = inertStructural }: { structural?: StructuralAuthoringController }) {
  const { state, dispatch } = useStrategyEditor();
  const projection = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const graph = useMemo(() => projectProductionFlowCanvas(projection), [projection]);
  const options = useMemo(() => constructionOptions(projection, structural.capabilities, state.editor.selection), [projection, structural.capabilities, state.editor.selection]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SemanticNode>(graph.nodes);
  const [pendingOption, setPendingOption] = useState<ConstructionOption | null>(null);
  const [draftNode, setDraftNode] = useState<SemanticNode | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const activeOption = pendingOption ?? (state.editor.flowDraft.intent
    ? options.find((item) => item.kind === state.editor.flowDraft.intent?.kind
      && item.targetComponentId === state.editor.flowDraft.intent?.targetComponentId) ?? null
    : null);

  useEffect(() => setNodes((current) => mergeFlowNodePositions(graph.nodes, current)), [graph.nodes, setNodes]);
  useEffect(() => {
    if (state.editor.flowDraft.status === "clean") setDraftNode(null);
  }, [state.editor.flowDraft.status]);

  // xyflow owns positions, but the current Canonical projection owns node identity.
  // Reconcile synchronously so Fast Refresh or a branch fast-forward cannot leak a
  // preserved legacy node list into the final ReactFlow boundary before the effect runs.
  const committedNodes = mergeFlowNodePositions(graph.nodes, nodes);
  const displayed = [...committedNodes, ...(draftNode ? [draftNode] : [])]
    .map((item) => ({ ...item, selected: sameSemanticSelection(item.data.selection, state.editor.selection) }));
  const draftConnection = state.editor.flowDraft.connection;
  const displayedIds = new Set(displayed.map((item) => item.id));
  const edges = draftConnection && displayedIds.has(draftConnection.sourceId) && displayedIds.has(draftConnection.targetId)
    ? [...graph.edges, edge(draftConnection.sourceId, draftConnection.targetId, "decision-detail", "working connection", draftConnection.sourceHandle ?? undefined)]
    : graph.edges;

  const clearDraft = useCallback(() => {
    setPendingOption(null);
    setDraftNode(null);
    dispatch({ type: "clear_flow_draft" });
  }, [dispatch]);

  const removeSelected = useCallback(() => {
    if (draftNode && state.editor.flowDraft.status !== "clean") {
      clearDraft();
      return;
    }
    const operation = semanticDeleteOperation(state.editor.selection, structural.capabilities);
    if (operation) void structural.apply(operation, null);
    else setConnectionNotice("This unit cannot be removed safely in Flow. Use its Inspector or resolve the surrounding topology.");
  }, [clearDraft, draftNode, state.editor.flowDraft.status, state.editor.selection, structural]);

  const beginDraft = (option: ConstructionOption, position?: { x: number; y: number }) => {
    setPendingOption(option);
    if (position) setDraftNode(createFlowDraftNode(option, position));
    dispatch({ type: "begin_flow_draft", intent: {
      kind: option.kind, targetComponentId: option.targetComponentId,
      targetLabel: option.targetLabel, groupId: option.groupId,
    } });
  };
  const applyDraft = async (operation: () => Promise<boolean>) => {
    dispatch({ type: "set_flow_draft_status", status: "commit_ready", message: "Applying the complete Flow topology…" });
    const ok = await operation();
    if (ok) clearDraft();
    else dispatch({ type: "set_flow_draft_status", status: "incomplete", message: "The backend rejected this Flow change. The committed Strategy is unchanged." });
    return ok;
  };

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      const intent = JSON.parse(event.dataTransfer.getData("application/x-ruletrade-concept")) as { kind: string; targetComponentId: string };
      const option = options.find((item) => item.kind === intent.kind && item.targetComponentId === intent.targetComponentId);
      if (!option) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: Math.max(40, event.clientX - bounds.left - 110),
        y: Math.max(40, event.clientY - bounds.top - 40),
      };
      dispatch({ type: "select_semantic", selection: option.anchorSelection });
      beginDraft(option, position);
    } catch {
      setConnectionNotice("That drop did not contain a RuleTrade Flow concept.");
    }
  }, [dispatch, options]);

  const handleNodesChange = useCallback((changes: NodeChange<SemanticNode>[]) => {
    const committedChanges = changes.filter((change) => !draftNode || !("id" in change) || change.id !== draftNode.id);
    if (committedChanges.length > 0) onNodesChange(committedChanges);
    if (!draftNode) return;
    for (const change of changes) {
      if (!("id" in change) || change.id !== draftNode.id) continue;
      if (change.type === "position" && change.position) {
        setDraftNode((current) => current ? { ...current, position: change.position! } : current);
      }
    }
  }, [draftNode, onNodesChange]);

  const nodeById = useMemo(() => new Map(displayed.map((item) => [item.id, item])), [displayed]);
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
    const workingConnection = {
      sourceId: connection.source, targetId: connection.target, sourceKind, targetKind,
      sourceHandle: connection.sourceHandle,
    };
    if (activeOption && draftNode?.id === connection.target) {
      if (isCommitReadyFlowConnection(activeOption, sourceKind, targetKind)) {
        dispatch({ type: "set_flow_draft_connection", status: "commit_ready", connection: workingConnection,
          message: "Complete Split topology · applying automatically…" });
        void applyDraft(() => dispatchSplitConstruction(activeOption, structural));
        return;
      }
      dispatch({ type: "set_flow_draft_connection", status: "incomplete", connection: workingConnection,
        message: `Connected ${activeOption.label}. Finish its semantic configuration to commit.` });
      return;
    }
    dispatch({ type: "set_flow_draft_connection", status: "valid_but_unsupported", connection: workingConnection,
      message: "This capital relationship is meaningful, but no unambiguous backend intent exists yet. Canonical remains unchanged." });
  }, [activeOption, dispatch, draftNode, nodeById, structural]);

  const draftActive = state.editor.flowDraft.status !== "clean";
  const canvasActive = state.editor.activeView === "flow";
  return <div className="flow-representation" tabIndex={0} data-flow-draft-status={state.editor.flowDraft.status}
    data-flow-runtime-contract="minimal-capital-v2"
    data-flow-projection-manifest={productionFlowNodeManifest(graph.nodes)}
    data-flow-node-manifest={productionFlowNodeManifest(displayed)}
    data-flow-canvas-mounted={canvasActive ? "true" : "false"}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-ruletrade-concept")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
    onDrop={onDrop}
    onKeyDown={(event) => {
      if (event.key === "Escape") dispatch({ type: "select_semantic", selection: null });
      if ((event.key === "Delete" || event.key === "Backspace") && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) removeSelected();
    }}>
    {canvasActive && <div className="flow-reactflow-boundary" data-flow-reactflow-boundary
      data-flow-reactflow-node-manifest={productionFlowNodeManifest(displayed)}>
    <ReactFlow<SemanticNode, Edge>
      nodes={displayed} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodesDelete={(deleted) => { if (draftNode && deleted.some((item) => item.id === draftNode.id)) clearDraft(); }}
      onEdgesDelete={(deleted) => { if (deleted.some((item) => (item.data as { role?: FlowRelationshipRole } | undefined)?.role === "decision-detail")) dispatch({ type: "clear_flow_draft_connection" }); }}
      onNodeClick={(_, selected) => dispatch({ type: "select_semantic", selection: selected.data.selection })}
      onPaneClick={() => dispatch({ type: "select_semantic", selection: null })}
      nodesConnectable onConnect={onConnect} isValidConnection={isValidConnection}
      fitView fitViewOptions={{ padding: .1, maxZoom: 1.38 }} minZoom={.4} maxZoom={1.8}>
      <Background gap={24} size={1} /><Controls showInteractive={false} />
    </ReactFlow>
    </div>}
    <div className="flow-canvas-hint">Inspect detail · drag supported units · connect capital handles · pan/zoom stay local</div>
    {options.length > 0 && <div className="flow-add-hint">Drag a high-level Flow unit from Add, then connect and complete it.</div>}
    {connectionNotice && <div className="flow-connection-notice" role="status">{connectionNotice}<button onClick={() => setConnectionNotice(null)} aria-label="Dismiss Flow notice">×</button></div>}
    {draftActive && <div className={`flow-draft-status ${state.editor.flowDraft.status}`} role="status">
      <strong>{state.editor.flowDraft.status === "incomplete" ? "Unfinished Flow topology" : state.editor.flowDraft.status === "valid_but_unsupported" ? "Valid meaning, unavailable commit" : "Applying Flow topology"}</strong>
      <span>{state.editor.flowDraft.message}</span>
      <button className="text-button" onClick={clearDraft}>Discard Flow draft</button>
    </div>}
    {activeOption && <div className="flow-actions" aria-label="Pending Flow construction">
      {activeOption.kind === "qualification" && <section className="shape-transformation"><span className="eyebrow">Selection detail</span><h4>Add eligibility</h4><p>The shared Inspector edits the exact Condition after creation.</p><button className="primary-button" disabled={structural.status === "applying"} onClick={() => applyDraft(async () => {
        const operation = insertConditionBeforeRank(state.canonical, activeOption.targetComponentId);
        return operation ? structural.compose(operation, (result) => semanticSelection("qualification", result.created_component_ids.condition ?? null, { fieldPath: "condition", groupId: activeOption.groupId })) : false;
      })}>Add eligibility condition</button></section>}
      {activeOption.kind === "metric" && <MetricConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => applyDraft(async () => {
        const operation = composeRankedSelectionPipeline(state.canonical, activeOption.targetComponentId, lookback, count);
        return operation ? structural.compose(operation, (result) => semanticSelection("rule", result.created_component_ids.metric ?? null, { fieldPath: "config.lookback_bars", groupId: activeOption.groupId })) : false;
      })} />}
      {activeOption.kind === "choose" && <ChooseTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(lookback, count) => applyDraft(() => structural.apply({
        kind: "transform_to_choose_assets", weight_component_id: activeOption.targetComponentId, lookback_observations: lookback, count,
      }, semanticSelection("selection", `${activeOption.targetComponentId}_top_n`, { groupId: activeOption.groupId })))} />}
      {activeOption.kind === "fallback" && <FallbackTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(asset) => applyDraft(() => structural.apply({
        kind: "add_fallback_selection", weight_component_id: activeOption.targetComponentId, fallback_asset: asset,
      }, semanticSelection("fallback", `${activeOption.targetComponentId}_fallback`, { groupId: activeOption.groupId })))} />}
      {activeOption.kind === "cooldown" && <CooldownConstructionControl busy={structural.status === "applying"} error={structural.error} onApply={(duration) => applyDraft(() => structural.apply({
        kind: "add_cooldown_to_selection", selection_component_id: activeOption.targetComponentId, duration,
      }, semanticSelection("cooldown", `${activeOption.targetComponentId}_cooldown`, { fieldPath: "config.duration", groupId: activeOption.groupId })))} />}
      {activeOption.kind === "split" && <GrowthDefensiveTransformationControl busy={structural.status === "applying"} error={structural.error} onApply={(allocation, assets) => applyDraft(() => dispatchSplitConstruction(activeOption, structural, allocation, assets))} />}
      <button className="text-button" onClick={clearDraft}>Cancel</button>
    </div>}
  </div>;
}
