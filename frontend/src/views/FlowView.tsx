import { memo, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { projectFlow, type StrategyFlowNodeData } from "../domain/flow";
import { useStrategyEditor } from "../store/editorStore";

const StrategyNode = memo(function StrategyNode({ data }: NodeProps) {
  const node = data as StrategyFlowNodeData & {
    onCountChange?: (value: number) => void;
    onResampleChange?: (value: string) => void;
    onLookbackChange?: (value: number) => void;
    onThresholdChange?: (value: string) => void;
    onTopNChange?: (value: number) => void;
    onFallbackChange?: (value: string) => void;
    onAllocationPairChange?: (value: string) => void;
  };
  return (
    <div className="strategy-node">
      <Handle type="target" position={Position.Left} />
      <span className="node-kicker">{node.componentId}</span>
      <strong>{node.title}</strong>
      {node.allocationPair !== undefined ? (
        <div className="node-fields"><label>Growth / Defensive<select value={node.allocationPair.value} onChange={(event) => node.onAllocationPairChange?.(event.target.value)}>
          <option value="0.70/0.30">70% / 30%</option>
          <option value="0.60/0.40">60% / 40%</option>
        </select></label></div>
      ) : node.fallbackAssetSetRef !== undefined ? (
        <div className="node-fields"><label>Use asset<select value={node.fallbackAssetSetRef} onChange={(event) => node.onFallbackChange?.(event.target.value)}>
          {node.fallbackOptions?.map((option) => <option key={option.id} value={option.id}>{option.asset}</option>)}
        </select></label></div>
      ) : node.threshold !== undefined ? (
        <div className="node-fields"><label>Threshold (%)<input type="number" step="0.1" value={Number(node.threshold) * 100} onChange={(event) => {
          if (event.target.value !== "") node.onThresholdChange?.(String(Number(event.target.value) / 100));
        }} /></label></div>
      ) : node.lookbackBars !== undefined ? (
        <div className="node-fields"><label>Trading days<input type="number" min={1} value={node.lookbackBars} onChange={(event) => node.onLookbackChange?.(Number(event.target.value))} /></label></div>
      ) : node.topN !== undefined ? (
        <div className="node-fields"><label>Count<input type="number" min={1} value={node.topN} onChange={(event) => node.onTopNChange?.(Number(event.target.value))} /></label></div>
      ) : node.randomCount === undefined ? (
        node.details.map((detail) => <span key={detail}>{detail}</span>)
      ) : (
        <div className="node-fields">
          <label>Count<input type="number" min={1} value={node.randomCount} onChange={(event) => node.onCountChange?.(Number(event.target.value))} /></label>
          <label>Resample<select value={node.resample} onChange={(event) => node.onResampleChange?.(event.target.value)}><option value="per_event">per_event</option><option value="once">once</option></select></label>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes = { strategy: StrategyNode };

export function FlowView() {
  const { state, dispatch } = useStrategyEditor();
  const projection = projectFlow(state.canonical, state.registry, state.editor.nodePositions);
  const nodes = useMemo(
    () => projection.nodes.map((node) => ({
      ...node,
      selected: state.editor.selectedNodeId === node.id,
      data: {
        ...node.data,
        onCountChange: (value: number) => dispatch({
          type: "apply_semantic_patch",
          operation: { kind: "update_component_config", componentId: node.id, field: "count", value },
        }),
        onResampleChange: (value: string) => dispatch({
          type: "apply_semantic_patch",
          operation: { kind: "update_component_config", componentId: node.id, field: "resample", value },
        }),
        onLookbackChange: (value: number) => dispatch({
          type: "apply_semantic_patch",
          operation: { kind: "update_component_config", componentId: node.id, field: "lookback_bars", value },
        }),
        onThresholdChange: (value: string) => dispatch({
          type: "apply_semantic_patch",
          operation: { kind: "update_component_config", componentId: node.id, field: "threshold", value },
        }),
        onTopNChange: (value: number) => dispatch({
          type: "apply_semantic_patch",
          operation: { kind: "update_component_config", componentId: node.id, field: "count", value },
        }),
        onFallbackChange: (value: string) => dispatch({
          type: "apply_semantic_patch",
          operation: { kind: "update_component_config", componentId: node.id, field: "fallback_asset_set_ref", value },
        }),
        onAllocationPairChange: (value: string) => {
          if (!node.data.allocationPair) return;
          const [growth, defensive] = value.split("/");
          dispatch({
            type: "apply_semantic_patch",
            operation: {
              kind: "update_sleeve_allocations",
              allocations: [
                { componentId: node.data.allocationPair.growthComponentId, value: growth },
                { componentId: node.data.allocationPair.defensiveComponentId, value: defensive },
              ],
            },
          });
        },
      },
    })),
    [projection.nodes, state.editor.selectedNodeId, dispatch],
  );

  function onNodesChange(changes: NodeChange[]) {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        dispatch({ type: "move_node", componentId: change.id, position: change.position });
      }
      if (change.type === "select") {
        dispatch({ type: "select_node", componentId: change.selected ? change.id : null });
      }
    }
  }

  return (
    <div className="flow-view" aria-label="Flow strategy editor">
      <ReactFlow
        nodes={nodes}
        edges={projection.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        defaultViewport={state.editor.viewport}
        onMoveEnd={(_, viewport) => dispatch({ type: "set_viewport", viewport })}
        fitView
        minZoom={0.45}
      >
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
