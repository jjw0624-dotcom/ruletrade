import type { ReactNode } from "react";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import { useStrategyEditor } from "../store/editorStore";

function GuideObject({selection,question,answer,children}:{selection:SemanticSelection;question:string;answer:string;children?:ReactNode}) {
  const {state,dispatch}=useStrategyEditor(); const selected=sameSemanticSelection(selection,state.editor.selection);
  return <button className={`guide-object${selected?" selected":""}`} aria-pressed={selected} data-component-id={selection.componentId??undefined} data-field-path={selection.fieldPath??undefined} onClick={()=>dispatch({type:"select_semantic",selection})}><span>{question}</span><strong>{answer}</strong>{children}</button>;
}
export function GuidedView(){
  const {state}=useStrategyEditor();const projection=projectConceptualFlow(state.canonical,state.registry);
  return <div className="guide-representation" aria-label="Guided strategy editor"><header className="representation-intro"><span className="eyebrow">Guide</span><h1>How this strategy works</h1><p>Select any part to inspect or change it without leaving the Strategy workspace.</p></header><div className="guide-sequence">
    {projection.groups.map(group=><section className="guide-group" key={group.id}>
      <GuideObject selection={semanticSelection("group",group.sleeveComponentId??group.universeComponentId??null,{groupId:group.id})} question="Where should money go?" answer={`${group.label}${group.allocation?` · ${group.allocation}`:""}`}/>
      <GuideObject selection={semanticSelection("universe",group.universeComponentId??null,{groupId:group.id})} question="What can it invest in?" answer={group.assets.join(", ")}/>
      {group.choose&&<>{group.choose.filterComponentId?<GuideObject selection={semanticSelection("qualification",group.choose.filterComponentId,{fieldPath:"config.threshold",groupId:group.id})} question="Which assets qualify?" answer={group.choose.condition??"Supported qualification"}/>:<GuideObject selection={semanticSelection("selection",group.choose.selectionComponentId,{groupId:group.id})} question="Which assets qualify?" answer="No qualification condition"/>}
      {group.choose.lookbackComponentId&&<GuideObject selection={semanticSelection("rule",group.choose.lookbackComponentId,{fieldPath:"config.lookback_bars",groupId:group.id})} question="How much history should it measure?" answer={`${group.choose.lookbackBars} trading observations`}/>}<GuideObject selection={semanticSelection("selection",group.choose.selectionComponentId,{fieldPath:"config.count",groupId:group.id})} question="Which should it choose?" answer={`${group.choose.label} · ${group.choose.ranking??"Selection"}`}/>
      <GuideObject selection={group.choose.fallbackComponentId?semanticSelection("fallback",group.choose.fallbackComponentId,{groupId:group.id}):semanticSelection("selection",group.choose.selectionComponentId,{groupId:group.id})} question="What happens otherwise?" answer={group.choose.otherwise??"No fallback"}/></>}
      {group.scheduleComponentId&&<GuideObject selection={semanticSelection("schedule",group.scheduleComponentId,{groupId:group.id})} question="When should it check again?" answer={group.timing??"Scheduled"}/>} </section>)}
    {projection.rebalanceScheduleComponentId&&<GuideObject selection={semanticSelection("schedule",projection.rebalanceScheduleComponentId)} question="When should the portfolio rebalance?" answer={projection.rebalance??"Scheduled"}/>} </div></div>;
}
