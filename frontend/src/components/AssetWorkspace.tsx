import { LineSeries, createChart, type IChartApi } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { assetWorkspaceApi, type AssetDetail, type AssetSummary } from "../assetWorkspaceApi";
import type { CanonicalStrategyV1, ValueExpression } from "../domain/canonical";
import type { StrategyValueCapability } from "../structuralAuthoringApi";
import { ValueComposer } from "./ValueComposer";
import { describeValueExpression } from "../domain/valueSemantics";
import { historicalRuleReferences, type AssetMembershipAuthoringTarget } from "../domain/assetWorkspaceAuthoring";

type Historical = { runId: string; eventId: string; revisionId: string; asOf: string };
type Props = {
  initialSymbol?: string;
  strategyId?: string | null;
  revisionId?: string | null;
  strategy: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  historical?: Historical;
  membershipTargets?: AssetMembershipAuthoringTarget[];
  valueTargetLabel?: string | null;
  onUpdateMembership?: (target: AssetMembershipAuthoringTarget, assets: string[]) => Promise<boolean | void> | boolean | void;
  onUseValue?: (value: ValueExpression) => Promise<void> | void;
  onViewRule?: (componentId: string, fieldPath?: string | null, revisionId?: string | null) => void;
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

export function AssetWorkspace({ initialSymbol="QQQ", strategyId, revisionId, strategy, capabilities, historical, membershipTargets=[], valueTargetLabel, onUpdateMembership, onUseValue, onViewRule }: Props) {
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
    <main className="asset-detail">{status==="loading"&&<p role="status">Loading point-in-time research…</p>}{status==="error"&&<p role="alert">{message}</p>}{detail&&<><div className="asset-identity"><div><span className="eyebrow">{detail.asset.asset_type}</span><h3>{detail.asset.symbol}</h3><p>{detail.asset.name}</p></div><span className={`asset-data-status ${detail.asset.data_status}`}>{detail.asset.data_status}</span></div><PriceChart detail={detail}/><div className="asset-metrics">{detail.metrics.map((metric)=><article key={metric.id}><span>{metric.label}</span><strong>{metric.status==="available"?formatMetric(metric.value,metric.value_type):metric.status.replaceAll("_"," ")}</strong>{metric.reason&&<small>{metric.reason}</small>}</article>)}</div><section className="asset-strategy-context"><span className="eyebrow">Strategy context</span><h3>Where {detail.asset.symbol} is used</h3>
        {historical ? (detail.memberships.length ? <ul>{detail.memberships.map((membership)=><li key={membership.kind+membership.id}><button disabled={!membership.component_id} onClick={()=>onViewRule?.(membership.component_id!,null,detail.historical?.revision_id)}>{membership.label}</button><small>{membership.kind.replaceAll("_"," ")}</small></li>)}</ul> : <p>Not referenced by the persisted Strategy Revision.</p>) : <>
          {membershipTargets.length > 0 ? <ul className="asset-membership-targets">{membershipTargets.map((target)=>{const included=target.assets.includes(detail.asset.symbol);return <li key={target.kind+target.semanticId}><span><strong>{target.label}</strong><small>{target.kind==="group"?"Static Group":target.kind==="universe"?"Explicit Universe":"Explicit asset set"}</small></span>{target.componentId&&<button className="text-button" onClick={()=>onViewRule?.(target.componentId!)}>View rule</button>}<button className="secondary-button" disabled={!onUpdateMembership} onClick={()=>void onUpdateMembership?.(target,included?target.assets.filter((asset)=>asset!==detail.asset.symbol):[...target.assets,detail.asset.symbol])}>{included?"Remove":"Add"}</button></li>})}</ul> : <p>No backend-editable static Group or explicit Universe is available in this Strategy.</p>}
        </>}</section>
      {historical&&detail.historical&&<section className="asset-history"><span className="eyebrow">Decision-time evidence</span><h3>{detail.historical.session_id}</h3><p>Revision {detail.historical.revision_id.slice(0,8)}… · persisted, read only</p><p>{detail.historical.evidence.length} asset-specific Evidence records</p>{historicalRuleReferences(detail.historical.evidence).map((reference)=><button className="secondary-button" key={reference.componentId+(reference.fieldPath??"")} onClick={()=>onViewRule?.(reference.componentId,reference.fieldPath,detail.historical?.revision_id)}>View persisted rule · {reference.componentId}</button>)}</section>}
      {!historical&&<section className="asset-value-handoff"><span className="eyebrow">Use in Strategy</span><h3>{describeValueExpression(value)}</h3><ValueComposer expression={value} strategy={strategy} capabilities={capabilities} allowCandidate={false} onChange={setValue}/><button className="primary-button" disabled={!onUseValue} onClick={()=>void onUseValue?.(value)}>Use this Value in selected condition</button>{!onUseValue&&<small>Select a committed Predicate or Eligibility condition first.</small>}{onUseValue&&valueTargetLabel&&<small>Target: {valueTargetLabel}</small>}</section>}</>}</main></div>
    {comparison.length>=2&&<section className="asset-comparison"><header><span className="eyebrow">Compare</span><h3>{comparison.map((x)=>x.asset.symbol).join(" vs ")}</h3></header><table><thead><tr><th>Metric</th>{comparison.map((x)=><th key={x.asset.symbol}>{x.asset.symbol}</th>)}</tr></thead><tbody><tr><th>Current adjusted price</th>{comparison.map((x)=><td key={x.asset.symbol}>{formatMetric(x.metrics[0]?.value,x.metrics[0]?.value_type)}</td>)}</tr><tr><th>126-observation return</th>{comparison.map((x)=><td key={x.asset.symbol}>{x.metrics[1]?.status==="available"?formatMetric(x.metrics[1].value,x.metrics[1].value_type):x.metrics[1]?.status}</td>)}</tr><tr><th>Data through</th>{comparison.map((x)=><td key={x.asset.symbol}>{x.as_of}</td>)}</tr></tbody></table></section>}
    {message&&status!=="error"&&<p className="asset-workspace-message" role="status">{message}</p>}
  </section>;
}

export function ProgramAssetUniverseEditor({ assets: initialAssets, onCommit }: {
  assets: string[];
  onCommit: (assets: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetSummary[]>([]);
  const [selected, setSelected] = useState<string[]>(initialAssets);
  const [focused, setFocused] = useState(initialAssets[0] ?? "QQQ");
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<"all" | AssetSummary["asset_type"]>("all");
  const [dataStatus, setDataStatus] = useState<"all" | AssetSummary["data_status"]>("all");
  const [sort, setSort] = useState<"symbol" | "name">("symbol");
  const [selectedQuery, setSelectedQuery] = useState("");
  useEffect(() => setSelected(initialAssets), [initialAssets]);
  useEffect(() => {
    let live = true;
    assetWorkspaceApi.list(query).then(({ items }) => { if (live) { setResults(items); setMessage(null); } })
      .catch((reason) => { if (live) setMessage(reason instanceof Error ? reason.message : "Asset search is unavailable."); });
    return () => { live = false; };
  }, [query]);
  useEffect(() => {
    if (!focused) { setDetail(null); return; }
    let live = true;
    assetWorkspaceApi.detail(focused, today()).then((value) => { if (live) setDetail(value); })
      .catch(() => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [focused]);
  const add = (symbol: string) => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || selected.includes(normalized)) return;
    setSelected([...selected, normalized]); setFocused(normalized);
  };
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSelected(next);
  };
  const visibleResults = results
    .filter((asset) => assetType === "all" || asset.asset_type === assetType)
    .filter((asset) => dataStatus === "all" || asset.data_status === dataStatus)
    .sort((a, b) => a[sort].localeCompare(b[sort]));
  const visibleSelected = selected.filter((symbol) => symbol.toLowerCase().includes(selectedQuery.trim().toLowerCase()));
  return <section className="program-asset-universe" aria-label="Investment universe editor" data-workspace-layout="catalog-detail-basket">
    <aside className="asset-discovery-filters" aria-label="Asset search and filters">
      <header><span className="eyebrow">1 · Discover</span><h3>Search & filters</h3></header>
      <label>Find an asset<input aria-label="Search assets by ticker or name" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker or company name" /></label>
      <label>Instrument type<select aria-label="Instrument type" value={assetType} onChange={(event) => setAssetType(event.target.value as typeof assetType)}><option value="all">All supported</option><option value="ETF">ETF</option><option value="Equity">Equity</option></select></label>
      <label>Provider status<select aria-label="Provider status" value={dataStatus} onChange={(event) => setDataStatus(event.target.value as typeof dataStatus)}><option value="all">All statuses</option><option value="available">Available</option><option value="partial">Partial</option><option value="unavailable">Unavailable</option></select></label>
      <fieldset disabled aria-label="Unavailable provider filters"><legend>Provider fields</legend><label>Market<select><option>Not supplied</option></select></label><label>Sector<select><option>Not supplied</option></select></label><p>Exchange, sector, fundamentals and liquidity filters remain disabled until the provider supplies them.</p></fieldset>
      <details><summary>Enter a symbol manually</summary><div className="program-manual-symbol"><input aria-label="Manual asset symbol" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="TLT" /><button type="button" className="secondary-button" onClick={() => { add(manual); setManual(""); }}>Add symbol</button></div><p>Manual entry does not guarantee provider or historical-data availability.</p></details>
    </aside>
    <section className="asset-discovery-results" aria-label="Catalog results">
      <header><div><span className="eyebrow">2 · Catalog</span><h3>Instruments</h3></div><label>Sort<select aria-label="Sort instruments" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="symbol">Ticker</option><option value="name">Name</option></select></label></header>
      <div className="program-asset-search" role="list" aria-label="Asset search results">{visibleResults.map((asset) => {
        const included = selected.includes(asset.symbol);
        return <article role="listitem" key={asset.symbol} className={focused === asset.symbol ? "selected" : ""}>
          <button type="button" className="asset-result-identity" onClick={() => setFocused(asset.symbol)}><strong>{asset.symbol}</strong><span>{asset.name}</span><small>{asset.asset_type}</small></button>
          <span className={`asset-data-status ${asset.data_status}`}>{asset.data_status.replaceAll("_", " ")}</span>
          <button type="button" className="asset-result-add" disabled={included} aria-label={`Add ${asset.symbol} to selection`} onClick={() => add(asset.symbol)}>{included ? "Selected" : "+ Add"}</button>
        </article>;
      })}{visibleResults.length === 0 && <p>No instruments match the current supported filters.</p>}</div>
    </section>
    <section className="program-asset-preview" aria-label="Instrument details">
      <header><span className="eyebrow">3 · Inspect</span><h3>Instrument detail</h3></header>
      {detail ? <><div className="program-asset-identity"><div><strong>{detail.asset.symbol}</strong><span>{detail.asset.name}</span></div><span className={`asset-data-status ${detail.asset.data_status}`}>{detail.asset.data_status}</span><small>{detail.asset.asset_type} · adjusted daily prices · through {detail.as_of}</small></div><PriceChart detail={detail}/><div className="program-asset-metrics">{detail.metrics.map((metric) => <article key={metric.id}><span>{metric.label}</span><strong>{metric.status === "available" ? formatMetric(metric.value, metric.value_type) : metric.status.replaceAll("_", " ")}</strong>{metric.reason && <small>{metric.reason}</small>}</article>)}</div><button type="button" className="secondary-button" disabled={selected.includes(detail.asset.symbol)} onClick={() => add(detail.asset.symbol)}>{selected.includes(detail.asset.symbol) ? "Already selected" : `Add ${detail.asset.symbol}`}</button></> : <p>Select an instrument to inspect available point-in-time data.</p>}
    </section>
    <aside className="asset-selection-basket" aria-label="Selection basket">
      <header><div><span className="eyebrow">4 · Review</span><h3>Selection basket</h3></div><strong>{selected.length}</strong></header>
      <label>Search selected<input aria-label="Search selected assets" value={selectedQuery} onChange={(event) => setSelectedQuery(event.target.value)} placeholder="Ticker" /></label>
      <ol className="program-selected-assets" aria-label="Selected assets">{visibleSelected.map((symbol) => { const index = selected.indexOf(symbol); return <li key={symbol}>
        <button type="button" className="text-button" onClick={() => setFocused(symbol)}>{symbol}</button>
        <span className="asset-order-actions"><button type="button" aria-label={`Move ${symbol} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move ${symbol} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Remove ${symbol}`} onClick={() => setSelected(selected.filter((item) => item !== symbol))}>×</button></span>
      </li>; })}</ol>
      {selected.length === 0 && <p>No instruments selected yet.</p>}
      <button type="button" className="primary-button" disabled={JSON.stringify(selected) === JSON.stringify(initialAssets)} onClick={() => onCommit(selected)}>Use selected assets</button>
      <small>Changes remain temporary until you explicitly save the Group.</small>
    </aside>
    {message && <p className="asset-workspace-message" role="status">{message}</p>}
  </section>;
}

export function PriceChart({detail}:{detail:AssetDetail}) {
 const root=useRef<HTMLDivElement>(null); const chart=useRef<IChartApi|null>(null);
 useEffect(()=>{if(!root.current)return; const instance=createChart(root.current,{height:260,layout:{background:{color:"transparent"},textColor:"#64748b"},rightPriceScale:{borderVisible:false},timeScale:{borderVisible:false}}); const series=instance.addSeries(LineSeries,{color:"#2563eb",lineWidth:2});series.setData(detail.series.map((p)=>({time:p.date,value:Number(p.adjusted_close)})));instance.timeScale().fitContent();chart.current=instance;const resize=new ResizeObserver(()=>instance.applyOptions({width:root.current?.clientWidth??600}));resize.observe(root.current);return()=>{resize.disconnect();instance.remove();chart.current=null}},[detail]);
 return <div className="asset-price-chart" ref={root} role="img" aria-label={`${detail.asset.symbol} adjusted price through ${detail.as_of}`}/>;
}
