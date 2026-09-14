import { useCallback, useEffect, useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { semanticDeleteOperation } from "../domain/builderProjection";
import { sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";

export function shapeTransformationTargets(capabilities: StructuralAuthoringController["capabilities"]) { return { choose: capabilities?.choose_pipeline_targets[0], fallback: capabilities?.fallback_add_targets[0], growthDefensive: capabilities?.growth_defensive_targets[0] }; }

type SemanticNodeData = Record<string, unknown> & { title: string; detail: string; tone?: string; selection: SemanticSelection };
type SemanticNode = Node<SemanticNodeData, "semantic">;
function SemanticFlowNode({ data, selected }: NodeProps<SemanticNode>) { return <div className={`semantic-flow-node ${data.tone ?? ""}${selected ? " selected" : ""}`}><Handle type="target" position={Position.Top} isConnectable={false}/><strong>{data.title}</strong><span>{data.detail}</span><Handle type="source" position={Position.Bottom} isConnectable={false}/></div>; }
const nodeTypes = { semantic: SemanticFlowNode };
const node = (id:string,x:number,y:number,title:string,detail:string,selection:SemanticSelection,tone?:string):SemanticNode => ({id,type:"semantic",position:{x,y},data:{title,detail,selection,tone}});
const edge = (source:string,target:string,label?:string):Edge => ({id:`${source}-${target}`,source,target,label,type:"smoothstep",markerEnd:{type:MarkerType.ArrowClosed},className:"strategy-flow-edge"});

export function projectFlowCanvas(projection: ReturnType<typeof projectConceptualFlow>) {
  const nodes:SemanticNode[]=[]; const edges:Edge[]=[]; const rootId="portfolio";
  nodes.push(node(rootId,360,20,projection.title,projection.kind==="portfolio"?"Portfolio":"Strategy",semanticSelection("portfolio",projection.portfolioComponentId??null)));
  let parentId=rootId;
  if(projection.split){nodes.push(node("split",360,140,"Split portfolio",projection.groups.map(group=>group.allocation).join(" / "),semanticSelection("split",projection.portfolioComponentId??null),"split"));edges.push(edge(rootId,"split"));parentId="split";}
  projection.groups.forEach((group,index)=>{const x=projection.groups.length===1?360:170+index*310;const y=projection.split?270:150;const groupId=`group:${group.id}`;
    nodes.push(node(groupId,x,y,group.label,group.allocation??"Investment path",semanticSelection("group",group.sleeveComponentId??group.universeComponentId??null,{groupId:group.id}),index?"defensive":"growth"));edges.push(edge(parentId,groupId));
    const universeId=`universe:${group.id}`;nodes.push(node(universeId,x,y+130,"Assets",group.assets.join(" · "),semanticSelection("universe",group.universeComponentId??null,{groupId:group.id})));edges.push(edge(groupId,universeId));
    if(!group.choose)return;let pipeline=universeId;
    if(group.choose.filterComponentId){const id=`qualification:${group.id}`;nodes.push(node(id,x,y+260,"Qualification",group.choose.condition??"Supported condition",semanticSelection("qualification",group.choose.filterComponentId,{fieldPath:"config.threshold",groupId:group.id}),"qualification"));edges.push(edge(pipeline,id,"qualifies"));pipeline=id;}
    const selectId=`selection:${group.id}`;nodes.push(node(selectId,x,y+(group.choose.filterComponentId?390:260),group.choose.label,group.choose.ranking??"Selection",semanticSelection("selection",group.choose.selectionComponentId,{groupId:group.id}),"selection"));edges.push(edge(pipeline,selectId));
    if(group.choose.fallbackComponentId){const id=`fallback:${group.id}`;nodes.push(node(id,x+220,y+(group.choose.filterComponentId?390:260),"Fallback",group.choose.otherwise??"Alternative destination",semanticSelection("fallback",group.choose.fallbackComponentId,{groupId:group.id}),"fallback"));edges.push(edge(selectId,id,"if incomplete"));}
  });
  if(projection.rebalanceScheduleComponentId){const id="schedule";nodes.push(node(id,360,Math.max(...nodes.map(item=>item.position.y))+150,"Rebalance",projection.rebalance??"Schedule",semanticSelection("schedule",projection.rebalanceScheduleComponentId),"schedule"));edges.push(edge(rootId,id,"when"));}
  return {nodes,edges};
}

const inertStructural: StructuralAuthoringController = { capabilities:null, status:"ready", error:null, apply:async()=>false };
export function FlowView({structural=inertStructural}:{structural?:StructuralAuthoringController}) {
  const {state,dispatch}=useStrategyEditor();
  const projection=useMemo(()=>projectConceptualFlow(state.canonical,state.registry),[state.canonical,state.registry]);
  const graph=useMemo(()=>projectFlowCanvas(projection),[projection]);
  const [nodes,setNodes,onNodesChange]=useNodesState<SemanticNode>(graph.nodes);
  useEffect(()=>setNodes(current=>graph.nodes.map(projected=>({...projected,position:current.find(item=>item.id===projected.id)?.position??projected.position}))),[graph.nodes,setNodes]);
  const displayed=nodes.map(item=>({...item,selected:sameSemanticSelection(item.data.selection,state.editor.selection)}));
  const removeSelected=useCallback(()=>{const operation=semanticDeleteOperation(state.editor.selection,structural.capabilities);if(operation)void structural.apply(operation,null);},[state.editor.selection,structural]);
  return <div className="flow-representation" tabIndex={0} onKeyDown={event=>{if(event.key==="Escape")dispatch({type:"select_semantic",selection:null});if((event.key==="Delete"||event.key==="Backspace")&&!(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement))removeSelected();}}>
    <ReactFlow nodes={displayed} edges={graph.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(_,selected)=>dispatch({type:"select_semantic",selection:selected.data.selection})} onPaneClick={()=>dispatch({type:"select_semantic",selection:null})} nodesConnectable={false} deleteKeyCode={null} fitView fitViewOptions={{padding:.2}} minZoom={.35} maxZoom={1.8}><Background gap={24} size={1}/><Controls showInteractive={false}/></ReactFlow>
    <div className="flow-canvas-hint">Select to inspect · drag to arrange · scroll to zoom · drag the canvas to pan</div>
  </div>;
}
