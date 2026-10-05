import { LineSeries, createChart, type IChartApi } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { assetWorkspaceApi, type AssetDetail, type AssetSummary } from "../assetWorkspaceApi";
import type { CanonicalStrategyV1, ValueExpression } from "../domain/canonical";
import type { StrategyValueCapability } from "../structuralAuthoringApi";
import { ValueComposer } from "./ValueComposer";
import { describeValueExpression } from "../domain/valueSemantics";

type Historical = { runId: string; eventId: string; revisionId: string; asOf: string };
type Props = {
  initialSymbol?: string;
  strategyId?: string | null;
  revisionId?: string | null;
  strategy: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  historical?: Historical;
  onAddToUniverse?: (symbol: string) => Promise<void> | void;
  onUseValue?: (value: ValueExpression) => Promise<void> | void;
  onViewRule?: (componentId: string, fieldPath?: string | null) => void;
};

function today() { return new Date().toISOString().slice(0, 10); }
function formatMetric(value: string | null | undefined, type?: string | null) {
  if (value == null) return "—";
  const number = Number(value);
  if (type === "percentage") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(number);
  if (type?.startsWith("money")) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(number);
}
function assetPrice(symbol: string): ValueExpression {
  return { kind: "price", asset: { kind: "literal", value_type: "asset", value: symbol } } as ValueExpression;
}

export function AssetWorkspace({ initialSymbol="QQQ", strategyId, revisionId, strategy, capabilities, historical, onAddToUniverse, onUseValue, onViewRule }: Props) {
  const [query,setQuery]=useState("");
  const [assets,setAssets]=useState<AssetSummary[]>([]);
  const [symbol,setSymbol]=useState(initialSymbol);
  const [compare,setCompare]=useState<string[]>([initialSymbol]);
  const [detail,setDetail]=useState<AssetDetail|null>(null);
  const [comparison,setComparison]=useState<AssetDetail[]>([]);
  const [asOf,setAsOf]=useState(historical?.asOf ?? today());
  const [value,setValue]=useState<ValueExpression>(assetPrice(initialSymbol));
  const [status,setStatus]=useState<"loading"|"ready"|"error">("loading");
  const [message,setMessage]=useState<string|null>(null);
  useEffect(()=>{ let live=true; assetWorkspaceApi.list(query).then(({items})=>{if(live)setAssets(items)}).catch((e)=>{if(live)setMessage(e.message)}); return()=>{live=false}; },[query]);
  useEffect(()=>{ let live=true; setStatus("loading"); assetWorkspaceApi.detail(symbol,asOf,{strategyId,revisionId:historical?.revisionId ?? revisionId,runId:historical?.runId,eventId:historical?.eventId}).then((next)=>{if(live){setDetail(next);setStatus("ready");setValue(assetPrice(next.asset.symbol));}}).catch((e)=>{if(live){setStatus("error");setMessage(e.message)}}); return()=>{live=false}; },[symbol,asOf,strategyId,revisionId,historical?.runId,historical?.eventId,historical?.revisionId]);
  useEffect(()=>{if(compare.length<2){setComparison([]);return} let live=true; assetWorkspaceApi.compare(compare,asOf).then((r)=>{if(live)setComparison(r.items)}).catch((e)=>{if(live)setMessage(e.message)});return()=>{live=false}},[compare,asOf]);
  function toggleCompare(next:string){setCompare((items)=>items.includes(next)?items.filter((x)=>x!==next):items.length<4?[...items,next]:items)}
  return <section className="asset-workspace" aria-label="Asset Workspace">
    <header className="asset-workspace-header"><div><span className="eyebrow">Asset Workspace</span><h2>Research → Compare → Strategy</h2><p>{historical?"Historical decision context · read only":"Current research context"}</p></div><label>As of<input type="date" value={asOf} disabled={Boolean(historical)} onChange={(e)=>setAsOf(e.target.value)}/></label></header>
    <div className="asset-workspace-layout"><aside className="asset-browser"><label>Find an asset<input aria-label="Find an asset" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Ticker or name"/></label>{assets.map((item)=><div className={item.symbol===symbol?"asset-search-row selected":"asset-search-row"} key={item.symbol}><button onClick={()=>setSymbol(item.symbol)}><strong>{item.symbol}</strong><span>{item.name}</span><small>{item.data_status}</small></button><label><input type="checkbox" checked={compare.includes(item.symbol)} onChange={()=>toggleCompare(item.symbol)}/> Compare</label></div>)}</aside>
    <main className="asset-detail">{status==="loading"&&<p role="status">Loading point-in-time research…</p>}{status==="error"&&<p role="alert">{message}</p>}{detail&&<><div className="asset-identity"><div><span className="eyebrow">{detail.asset.asset_type}</span><h3>{detail.asset.symbol}</h3><p>{detail.asset.name}</p></div><span className={`asset-data-status ${detail.asset.data_status}`}>{detail.asset.data_status}</span></div><PriceChart detail={detail}/><div className="asset-metrics">{detail.metrics.map((metric)=><article key={metric.id}><span>{metric.label}</span><strong>{metric.status==="available"?formatMetric(metric.value,metric.value_type):metric.status.replaceAll("_"," ")}</strong>{metric.reason&&<small>{metric.reason}</small>}</article>)}</div><section className="asset-strategy-context"><span className="eyebrow">Strategy context</span><h3>Where {detail.asset.symbol} is used</h3>{detail.memberships.length?<ul>{detail.memberships.map((m)=><li key={m.kind+m.id}><button onClick={()=>onViewRule?.(m.id)}>{m.label}</button><small>{m.kind}</small></li>)}</ul>:<p>Not currently referenced by this Strategy.</p>}{!historical&&onAddToUniverse&&<button className="secondary-button" onClick={()=>void onAddToUniverse(detail.asset.symbol)}>Add to Strategy universe</button>}</section>
      {historical&&detail.historical&&<section className="asset-history"><span className="eyebrow">Decision-time evidence</span><h3>{detail.historical.session_id}</h3><p>Revision {detail.historical.revision_id.slice(0,8)}… · persisted, read only</p><p>{detail.historical.evidence.length} asset-specific Evidence records</p></section>}
      {!historical&&<section className="asset-value-handoff"><span className="eyebrow">Use in Strategy</span><h3>{describeValueExpression(value)}</h3><ValueComposer expression={value} strategy={strategy} capabilities={capabilities} allowCandidate={false} onChange={setValue}/><button className="primary-button" disabled={!onUseValue} onClick={()=>void onUseValue?.(value)}>Use this Value in selected condition</button></section>}</>}</main></div>
    {comparison.length>=2&&<section className="asset-comparison"><header><span className="eyebrow">Compare</span><h3>{comparison.map((x)=>x.asset.symbol).join(" vs ")}</h3></header><table><thead><tr><th>Metric</th>{comparison.map((x)=><th key={x.asset.symbol}>{x.asset.symbol}</th>)}</tr></thead><tbody><tr><th>Current adjusted price</th>{comparison.map((x)=><td key={x.asset.symbol}>{formatMetric(x.metrics[0]?.value,x.metrics[0]?.value_type)}</td>)}</tr><tr><th>126-observation return</th>{comparison.map((x)=><td key={x.asset.symbol}>{x.metrics[1]?.status==="available"?formatMetric(x.metrics[1].value,x.metrics[1].value_type):x.metrics[1]?.status}</td>)}</tr><tr><th>Data through</th>{comparison.map((x)=><td key={x.asset.symbol}>{x.as_of}</td>)}</tr></tbody></table></section>}
    {message&&status!=="error"&&<p className="asset-workspace-message" role="status">{message}</p>}
  </section>;
}

function PriceChart({detail}:{detail:AssetDetail}) {
 const root=useRef<HTMLDivElement>(null); const chart=useRef<IChartApi|null>(null);
 useEffect(()=>{if(!root.current)return; const instance=createChart(root.current,{height:260,layout:{background:{color:"transparent"},textColor:"#64748b"},rightPriceScale:{borderVisible:false},timeScale:{borderVisible:false}}); const series=instance.addSeries(LineSeries,{color:"#2563eb",lineWidth:2});series.setData(detail.series.map((p)=>({time:p.date,value:Number(p.adjusted_close)})));instance.timeScale().fitContent();chart.current=instance;const resize=new ResizeObserver(()=>instance.applyOptions({width:root.current?.clientWidth??600}));resize.observe(root.current);return()=>{resize.disconnect();instance.remove();chart.current=null}},[detail]);
 return <div className="asset-price-chart" ref={root} role="img" aria-label={`${detail.asset.symbol} adjusted price through ${detail.as_of}`}/>;
}
