import { useMemo, useState } from "react";
import { conceptualOnlyAllocationExample, projectConceptualFlow, type ConceptualGroup } from "../domain/conceptualFlow";
import { useStrategyEditor } from "../store/editorStore";

export function ConceptualFlowPreview({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStrategyEditor();
  const projection = useMemo(() => projectConceptualFlow(state.canonical, state.registry), [state.canonical, state.registry]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("portfolio");
  const group = projection.groups.find((item) => item.id === groupId);
  const selectedGroup = projection.groups.find((item) => item.id === selected);
  function focus(ids: string[]) { const id=ids[0]; if(id) dispatch({ type: "select_node", componentId: id }); }
  return <section className="concept-flow" aria-label="Conceptual Flow v2 preview"><header><div><span className="eyebrow">Experimental projection · read only</span><h2>{projection.title}</h2><p>Where money can go, how it is chosen, and when the strategy checks again.</p></div><button className="secondary-button" onClick={onClose}>Back to current Flow</button></header>
    <nav className="concept-breadcrumb" aria-label="Flow hierarchy"><button onClick={() => setGroupId(null)}>Portfolio</button>{group && <><span>/</span><b>{group.label}</b></>}</nav>\n    <div className="concept-palette" aria-label="Conceptual creation palette"><div><strong>Where can money go?</strong><span>Asset</span><span>Group</span><span>Cash</span></div><div><strong>How should it choose?</strong><span>Choose assets</span><span>When / Otherwise</span></div><div><strong>How should money be split?</strong><span>Split</span></div><div><strong>What happens over time?</strong><span>Rebalance</span><span title="Concept only">Add money · concept</span></div></div>
    <div className="concept-workspace"><div className="concept-canvas">{!group ? <PortfolioCanvas projection={projection} onOpen={(item) => { setGroupId(item.id); setSelected(item.id); focus(item.sourceComponentIds); }} onSelect={(id) => setSelected(id)} /> : <GroupCanvas group={group} onSelect={(id) => { setSelected(id); focus(id === "choose" ? group.choose?.sourceComponentIds ?? [] : group.sourceComponentIds); }} />}</div><Inspector group={selected === "choose" ? group : selectedGroup ?? group} choose={selected === "choose"} /></div>
    <details className="concept-only-example"><summary>Conceptual-only coverage</summary><strong>{conceptualOnlyAllocationExample.label}</strong><p>{conceptualOnlyAllocationExample.summary}</p><small>Not executable: {conceptualOnlyAllocationExample.reason}</small></details>
  </section>;
}
function PortfolioCanvas({ projection, onOpen, onSelect }: { projection: ReturnType<typeof projectConceptualFlow>; onOpen: (group: ConceptualGroup) => void; onSelect: (id: string) => void }) {
  return <div className="capital-flow"><button className="concept-node root" onClick={() => onSelect("portfolio")}><span>Portfolio</span><small>{projection.rebalance ? `Rebalance: ${projection.rebalance}` : "100% of invested money"}</small></button><div className="split-line" aria-hidden="true" /><div className="concept-groups">{projection.groups.map((group)=><button key={group.id} className="concept-node group" onClick={()=>onOpen(group)}><span>{group.label}{group.allocation && <b>{group.allocation}</b>}</span><small>{group.choose?.label ?? group.assets.join(" · ")}</small>{group.timing && <em>Check: {group.timing}</em>}</button>)}</div></div>;
}
function GroupCanvas({ group, onSelect }: { group: ConceptualGroup; onSelect: (id: string) => void }) {
  return <div className="capital-flow group-detail"><button className="concept-node group" onClick={()=>onSelect(group.id)}><span>{group.label}</span><small>{group.assets.join(" · ")}</small>{group.timing && <em>Check: {group.timing}</em>}</button>{group.choose && <><div className="flow-arrow">↓</div><button className="concept-node choose" onClick={()=>onSelect("choose")}><span>{group.choose.label}</span>{group.choose.condition && <small>{group.choose.condition}</small>}<small>{group.choose.ranking}</small>{group.choose.otherwise && <em>{group.choose.otherwise}</em>}</button></>}</div>;
}
function Inspector({ group, choose }: { group?: ConceptualGroup; choose: boolean }) {
  if(!group)return <aside className="concept-inspector"><span className="eyebrow">Split money</span><p>Select a destination to inspect it.</p></aside>;
  if(choose && group.choose)return <aside className="concept-inspector"><span className="eyebrow">Choose assets</span><h3>{group.choose.label}</h3><dl><dt>From</dt><dd>{group.choose.from.join(", ")}</dd>{group.choose.condition && <><dt>Only include when</dt><dd>{group.choose.condition}</dd></>}<dt>Then rank by</dt><dd>{group.choose.ranking}</dd>{group.choose.otherwise && <><dt>If there aren't enough</dt><dd>{group.choose.otherwise.replace("Otherwise → ","")}</dd></>}{group.choose.cooldown && <><dt>After selling</dt><dd>{group.choose.cooldown}</dd></>}{group.choose.timing && <><dt>Re-evaluate choices</dt><dd>{group.choose.timing}</dd></>}</dl><small>Projected from {group.choose.sourceComponentIds.length} Canonical components. Editing remains in Guided/current Flow.</small></aside>;
  return <aside className="concept-inspector"><span className="eyebrow">Group</span><h3>{group.label}</h3><dl>{group.allocation && <><dt>Allocation</dt><dd>{group.allocation}</dd></>}<dt>Where money can go</dt><dd>{group.assets.join(", ")}</dd>{group.timing && <><dt>Re-evaluate</dt><dd>{group.timing}</dd></>}</dl></aside>;
}
