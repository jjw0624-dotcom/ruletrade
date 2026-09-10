import { projectGuided } from "../domain/guided";
import { useStrategyEditor } from "../store/editorStore";
import { AssetMembershipEditor, LookbackControl, ScheduleControl, SleeveAllocationEditor } from "../components/AuthoringControls";

function percent(value: string) {
  return `${Math.round(Number(value) * 100)}%`;
}

export function GuidedView() {
  const { state, dispatch } = useStrategyEditor();
  const guided = projectGuided(state.canonical, state.registry);
  const focusClass = (componentId?: string, fieldPath?: string) => componentId && state.editor.selectedNodeId === componentId && (!state.editor.selectedFieldPath || state.editor.selectedFieldPath === fieldPath) ? "guided-rule-focus" : "";
  const viewInFlow = (componentId: string) => { dispatch({ type: "select_node", componentId }); dispatch({ type: "set_active_view", view: "flow" }); };

  if (guided.kind === "portfolio") {
    return (
      <div className="guided-view" aria-label="Guided strategy editor">
        <section className="sleeve-card portfolio-card">
          <header><div><span className="eyebrow">Portfolio</span><h2>{guided.portfolio.name}</h2></div></header>
          <label>How should the money be split?</label><SleeveAllocationEditor groups={[{id:"growth",label:guided.growth.sleeveName,componentId:guided.growth.sleeveComponentId,allocation:guided.growth.allocation},{id:"defensive",label:guided.defensive.sleeveName,componentId:guided.defensive.sleeveComponentId,allocation:guided.defensive.allocation}]}/>
        </section>
        <section className="sleeve-card">
          <header><div><span className="eyebrow">Portfolio sleeve</span><h2>{guided.growth.sleeveName}</h2></div><strong>{percent(guided.growth.allocation)}</strong></header>
          <AssetMembershipEditor assetSetId={guided.growth.assetSetId} assets={guided.growth.assets}/>
          <div className={focusClass(guided.growth.lookbackComponentId, "config.lookback_bars")} data-component-id={guided.growth.lookbackComponentId} data-field-path="config.lookback_bars" tabIndex={state.editor.selectedNodeId === guided.growth.lookbackComponentId ? -1 : undefined}><LookbackControl id="guided-growth-lookback" componentId={guided.growth.lookbackComponentId} value={guided.growth.lookbackBars}/></div>
          {guided.growth.filterComponentId && <div className={`guided-question ${focusClass(guided.growth.filterComponentId, "config.threshold")}`} data-component-id={guided.growth.filterComponentId} data-field-path="config.threshold" tabIndex={state.editor.selectedNodeId === guided.growth.filterComponentId ? -1 : undefined}><header><span>Which assets qualify?</span><button className="text-button" onClick={() => viewInFlow(guided.growth.filterComponentId!)}>View in Flow</button></header><label htmlFor="guided-growth-threshold">{guided.growth.lookbackBars}-day return above <span className="inline-percent"><input id="guided-growth-threshold" type="number" step="0.1" value={Number(guided.growth.threshold ?? 0) * 100} onChange={(event) => { if (event.target.value !== "") dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: guided.growth.filterComponentId!, field: "threshold", value: String(Number(event.target.value) / 100) } }); }} />%</span></label></div>}
          <div className={`summary-row ${focusClass(guided.growth.rankComponentId, "config.direction")}`} data-component-id={guided.growth.rankComponentId} data-field-path="config.direction" tabIndex={state.editor.selectedNodeId === guided.growth.rankComponentId ? -1 : undefined}><span>How should it choose among them?</span><strong>Strongest return first</strong></div>
          <label className={focusClass(guided.growth.selectionComponentId,"config.count")} data-component-id={guided.growth.selectionComponentId} data-field-path="config.count">How many should it choose?<input type="number" min={1} value={guided.growth.topN} onChange={event=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:guided.growth.selectionComponentId,field:"count",value:Number(event.target.value)}})}/></label>
          {guided.growth.fallbackComponentId&&<label className={focusClass(guided.growth.fallbackComponentId,"config.fallback_asset_set_ref")} data-component-id={guided.growth.fallbackComponentId} data-field-path="config.fallback_asset_set_ref">What if there aren't enough?<select value={guided.growth.fallbackAssetSetRef} onChange={event=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:guided.growth.fallbackComponentId!,field:"fallback_asset_set_ref",value:event.target.value}})}>{guided.growth.fallbackOptions.map(option=><option key={option.id} value={option.id}>Use {option.asset}</option>)}</select></label>}
          {guided.growth.cooldownComponentId&&<label className={focusClass(guided.growth.cooldownComponentId,"config.duration")} data-component-id={guided.growth.cooldownComponentId} data-field-path="config.duration">After selling, wait<input type="number" min={1} value={guided.growth.cooldownDuration} onChange={event=>dispatch({type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:guided.growth.cooldownComponentId!,field:"duration",value:Number(event.target.value)}})}/> completed trading days before buying again.</label>}
          {guided.growth.refreshScheduleComponentId ? <ScheduleControl label="When should it check again?" componentId={guided.growth.refreshScheduleComponentId} value={guided.growth.refreshSchedule!}/> : null}
        </section>
        <section className="sleeve-card safe">
          <header><div><span className="eyebrow">Portfolio sleeve</span><h2>{guided.defensive.sleeveName}</h2></div><strong>{percent(guided.defensive.allocation)}</strong></header>
          <AssetMembershipEditor question="What does it hold?" assetSetId={guided.defensive.assetSetId} assets={guided.defensive.assets}/>
          <div className="summary-row"><span>How is it divided?</span><span>Split equally</span></div>
          {guided.defensive.refreshScheduleComponentId ? <ScheduleControl label="When should it check again?" componentId={guided.defensive.refreshScheduleComponentId} value={guided.defensive.refreshSchedule!}/> : null}
        </section>
        {guided.rebalanceScheduleComponentId ? <section className="sleeve-card portfolio-card">
          <ScheduleControl label="When should the whole portfolio rebalance?" componentId={guided.rebalanceScheduleComponentId} value={guided.rebalanceSchedule!}/>
        </section> : null}
      </div>
    );
  }

  if (guided.kind === "momentum") {
    return (
      <div className="guided-view" aria-label="Guided strategy editor">
        <section className="sleeve-card">
          <header><div><span className="eyebrow">Momentum strategy</span><h2>Highest trailing return</h2></div><strong>{percent(guided.momentum.total)}</strong></header>
          <AssetMembershipEditor assetSetId={guided.momentum.assetSetId} assets={guided.momentum.assets}/>
          <div className="field-grid">
            <div className={`guided-field-pair ${focusClass(guided.momentum.lookbackComponentId, "config.lookback_bars")}`} data-component-id={guided.momentum.lookbackComponentId} data-field-path="config.lookback_bars" tabIndex={state.editor.selectedNodeId === guided.momentum.lookbackComponentId ? -1 : undefined}><LookbackControl id="guided-lookback" componentId={guided.momentum.lookbackComponentId} value={guided.momentum.lookbackBars}/></div>
            {guided.momentum.filterComponentId && guided.momentum.threshold !== undefined ? <div className={`guided-field-pair ${focusClass(guided.momentum.filterComponentId, "config.threshold")}`} data-component-id={guided.momentum.filterComponentId} data-field-path="config.threshold" tabIndex={state.editor.selectedNodeId === guided.momentum.filterComponentId ? -1 : undefined}>
              <label htmlFor="guided-threshold">Which assets qualify? Return above (%)</label>
              <input id="guided-threshold" type="number" step="0.1" value={Number(guided.momentum.threshold) * 100} onChange={(event) => {
                if (event.target.value === "") return;
                dispatch({
                  type: "apply_semantic_patch",
                  operation: { kind: "update_component_config", componentId: guided.momentum.filterComponentId!, field: "threshold", value: String(Number(event.target.value) / 100) },
                });
              }} /><button className="text-button field-link" onClick={() => viewInFlow(guided.momentum.filterComponentId!)}>View in Flow</button>
            </div> : null}
            <div className={`guided-field-pair ${focusClass(guided.momentum.selectionComponentId, "config.count")}`} data-component-id={guided.momentum.selectionComponentId} data-field-path="config.count" tabIndex={state.editor.selectedNodeId === guided.momentum.selectionComponentId ? -1 : undefined}><label htmlFor="guided-top-n">How many should it choose?</label>
            <input id="guided-top-n" type="number" min={1} value={guided.momentum.topN} onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: { kind: "update_component_config", componentId: guided.momentum.selectionComponentId, field: "count", value: Number(event.target.value) },
            })} /></div>
          </div>
          <div className={`summary-row ${focusClass(guided.momentum.rankComponentId, "config.direction")}`} data-component-id={guided.momentum.rankComponentId} data-field-path="config.direction" tabIndex={state.editor.selectedNodeId === guided.momentum.rankComponentId ? -1 : undefined}><span>How should it choose among them?</span><span>Strongest return first</span></div>
          <div className="summary-row"><span>How should the money be split?</span><span>Equally · {percent(guided.momentum.total)}</span></div>
          {guided.momentum.cooldownComponentId ? (
            <label className={focusClass(guided.momentum.cooldownComponentId, "config.duration")} data-component-id={guided.momentum.cooldownComponentId} data-field-path="config.duration" tabIndex={state.editor.selectedNodeId === guided.momentum.cooldownComponentId ? -1 : undefined} htmlFor="guided-cooldown">After selling, wait
              <input id="guided-cooldown" type="number" min={1} value={guided.momentum.cooldownDuration} onChange={(event) => dispatch({
                type: "apply_semantic_patch",
                operation: {
                  kind: "update_component_config",
                  componentId: guided.momentum.cooldownComponentId!,
                  field: "duration",
                  value: Number(event.target.value),
                },
              })} /> completed trading days before buying again.
            </label>
          ) : null}
          {guided.momentum.fallbackComponentId ? (
            <div className="summary-row">
              <label htmlFor="guided-fallback">What if fewer than {guided.momentum.topN} assets qualify?</label>
              <select id="guided-fallback" value={guided.momentum.fallbackAssetSetRef} onChange={(event) => dispatch({
                type: "apply_semantic_patch",
                operation: {
                  kind: "update_component_config",
                  componentId: guided.momentum.fallbackComponentId!,
                  field: "fallback_asset_set_ref",
                  value: event.target.value,
                },
              })}>
                {guided.momentum.fallbackOptions.map((option) => (
                  <option key={option.id} value={option.id}>Use {option.asset}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="summary-row"><span>If fewer than {guided.momentum.topN} assets qualify</span><span>Skip this rebalance</span></div>
          )}
          {guided.momentum.scheduleComponentId?<ScheduleControl label="When should it check again?" componentId={guided.momentum.scheduleComponentId} value={guided.momentum.schedule}/>:<div className="summary-row"><span>When should it check again?</span><span>{guided.momentum.schedule}</span></div>}
        </section>
      </div>
    );
  }

  return (
    <div className="guided-view" aria-label="Guided strategy editor">
      <section className="sleeve-card">
        <header><div><span className="eyebrow">Growth sleeve</span><h2>Growth</h2></div><strong>{percent(guided.growth.total)}</strong></header>
        <AssetMembershipEditor assetSetId={guided.growth.assetSetId} assets={guided.growth.assets}/>
        <div className="field-grid">
          <div className={`guided-field-pair ${focusClass(guided.growth.selectionComponentId, "config.count")}`} data-component-id={guided.growth.selectionComponentId} data-field-path="config.count" tabIndex={state.editor.selectedNodeId === guided.growth.selectionComponentId ? -1 : undefined}><label htmlFor="guided-random-count">Random Select count</label>
          <input
            id="guided-random-count"
            type="number"
            min={1}
            max={guided.growth.assets.length}
            value={guided.growth.randomCount}
            onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: {
                kind: "update_component_config",
                componentId: guided.growth.selectionComponentId,
                field: "count",
                value: Number(event.target.value),
              },
            })}
          /></div>
          <label htmlFor="guided-resample">Resample</label>
          <select
            id="guided-resample"
            value={guided.growth.resample}
            onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: {
                kind: "update_component_config",
                componentId: guided.growth.selectionComponentId,
                field: "resample",
                value: event.target.value,
              },
            })}
          >
            <option value="per_event">Per event</option>
            <option value="once">Once</option>
          </select>
        </div>
        <div className="summary-row"><span>Allocation</span><span>Equal Weight · {percent(guided.growth.total)}</span></div>
      </section>

      <section className="sleeve-card safe">
        <header><div><span className="eyebrow">Safety sleeve</span><h2>Safe</h2></div><strong>{percent(guided.safe.total)}</strong></header>
        <AssetMembershipEditor question="What does it hold?" assetSetId={guided.safe.assetSetId} assets={guided.safe.assets}/>
        <div className="summary-row"><span>Selection</span><span>All assets</span></div>
        <div className="summary-row"><span>Allocation</span><span>Equal Weight · {percent(guided.safe.total)}</span></div>
      </section>
    </div>
  );
}
