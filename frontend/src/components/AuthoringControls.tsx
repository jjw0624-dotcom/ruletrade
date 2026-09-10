import { useState } from "react";
import { useStrategyEditor } from "../store/editorStore";

export function AssetMembershipEditor({ assetSetId, assets, question = "What can it choose from?" }: { assetSetId: string; assets: string[]; question?: string }) {
  const { dispatch } = useStrategyEditor();
  const [ticker, setTicker] = useState("");
  const add = () => {
    if (!ticker.trim()) return;
    dispatch({ type:"apply_semantic_patch", operation:{kind:"update_asset_set_assets",assetSetId,assets:[...assets,ticker]} });
    setTicker("");
  };
  return <div className="asset-membership"><label>{question}</label><div className="asset-chips">{assets.map(asset=><span key={asset}>{asset}{assets.length>1&&<button type="button" aria-label={`Remove ${asset}`} onClick={()=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_asset_set_assets",assetSetId,assets:assets.filter(item=>item!==asset)}})}>×</button>}</span>)}</div><div className="asset-add"><label className="sr-only" htmlFor={`asset-${assetSetId}`}>Ticker symbol</label><input id={`asset-${assetSetId}`} value={ticker} onChange={event=>setTicker(event.target.value.toUpperCase())} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();add()}}} placeholder="Add ticker"/><button type="button" className="secondary-button" onClick={add}>Add asset</button></div><small>A valid ticker can be saved here. Backtests currently run only with the built-in datasets and symbols they contain.</small></div>;
}

export function LookbackControl({ componentId, value, id }: { componentId: string; value: number; id: string }) {
  const { dispatch } = useStrategyEditor();
  const presets = [21,63,126,252];
  const selected = presets.includes(value) ? String(value) : "custom";
  const update=(next:number)=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId,field:"lookback_bars",value:next}});
  return <div className="lookback-control"><label htmlFor={`${id}-preset`}>Return period</label><select id={`${id}-preset`} value={selected} onChange={event=>{if(event.target.value!=="custom")update(Number(event.target.value))}}><option value="21">About 1 month</option><option value="63">About 3 months</option><option value="126">About 6 months</option><option value="252">About 12 months</option><option value="custom">Custom…</option></select>{selected==="custom"&&<label htmlFor={`${id}-custom`}>Completed trading observations<input id={`${id}-custom`} type="number" min={1} value={value} onChange={event=>update(Number(event.target.value))}/></label>}<small>{value} completed trading observations—not calendar days.</small></div>;
}

export function SleeveAllocationEditor({ groups }: { groups: Array<{ id:string; label:string; componentId:string; allocation:string }> }) {
  const { dispatch } = useStrategyEditor();
  const [values,setValues]=useState(groups.map(group=>String(Number(group.allocation)*100)));
  const total=values.reduce((sum,value)=>sum+Number(value),0);
  return <div className="allocation-editor">{groups.map((group,index)=><label key={group.id}>{group.label}<span className="percent-field"><input type="number" min={0.01} max={100} step="0.1" value={values[index]} onChange={event=>setValues(values.map((value,current)=>current===index?event.target.value:value))}/>%</span></label>)}<div className={total===100?"split-total valid":"split-total invalid"} role="status">Total {total}% {total===100?"✓":"— must equal 100%"}</div><button className="primary-button" disabled={total!==100} onClick={()=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_sleeve_allocations",allocations:groups.map((group,index)=>({componentId:group.componentId,value:String(Number(values[index])/100)}))}})}>Apply split</button><small>Both values update together. Invalid totals do not change the strategy.</small></div>;
}

export function ScheduleControl({ label, componentId, value }: { label:string; componentId:string; value:string }) {
  const {dispatch}=useStrategyEditor();
  return <label>{label}<select value={value.toLowerCase()} onChange={event=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_schedule",componentId,cadence:event.target.value as "daily"|"monthly"|"quarterly"}})}><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>;
}
