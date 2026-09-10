import { projectGuided } from "../domain/guided";
import { useStrategyEditor } from "../store/editorStore";

function AssetChips({ assets }: { assets: string[] }) {
  return <div className="asset-chips">{assets.map((asset) => <span key={asset}>{asset}</span>)}</div>;
}

function percent(value: string) {
  return `${Math.round(Number(value) * 100)}%`;
}

export function GuidedView() {
  const { state, dispatch } = useStrategyEditor();
  const guided = projectGuided(state.canonical, state.registry);
  const focusClass = (componentId?: string, fieldPath?: string) => componentId && state.editor.selectedNodeId === componentId && (!state.editor.selectedFieldPath || state.editor.selectedFieldPath === fieldPath) ? "guided-rule-focus" : "";
  const viewInFlow = (componentId: string) => { dispatch({ type: "select_node", componentId }); dispatch({ type: "set_active_view", view: "flow" }); };

  if (guided.kind === "portfolio") {
    const split = `${guided.growth.allocation}/${guided.defensive.allocation}`;
    return (
      <div className="guided-view" aria-label="Guided strategy editor">
        <section className="sleeve-card portfolio-card">
          <header><div><span className="eyebrow">Portfolio</span><h2>{guided.portfolio.name}</h2></div></header>
          <label htmlFor="guided-sleeve-split">How should the money be split?</label>
          <select id="guided-sleeve-split" value={split} onChange={(event) => {
            const [growth, defensive] = event.target.value.split("/");
            dispatch({
              type: "apply_semantic_patch",
              operation: {
                kind: "update_sleeve_allocations",
                allocations: [
                  { componentId: guided.growth.sleeveComponentId, value: growth },
                  { componentId: guided.defensive.sleeveComponentId, value: defensive },
                ],
              },
            });
          }}>
            <option value="0.70/0.30">Growth 70% / Defensive 30%</option>
            <option value="0.60/0.40">Growth 60% / Defensive 40%</option>
          </select>
        </section>
        <section className="sleeve-card">
          <header><div><span className="eyebrow">Portfolio sleeve</span><h2>{guided.growth.sleeveName}</h2></div><strong>{percent(guided.growth.allocation)}</strong></header>
          <label>What can it choose from?</label><AssetChips assets={guided.growth.assets} />
          <div className={`summary-row ${focusClass(guided.growth.lookbackComponentId, "config.lookback_bars")}`} data-component-id={guided.growth.lookbackComponentId} data-field-path="config.lookback_bars" tabIndex={state.editor.selectedNodeId === guided.growth.lookbackComponentId ? -1 : undefined}><span>How much recent history?</span><strong>{guided.growth.lookbackBars} trading days</strong></div>
          {guided.growth.filterComponentId && <div className={`guided-question ${focusClass(guided.growth.filterComponentId, "config.threshold")}`} data-component-id={guided.growth.filterComponentId} data-field-path="config.threshold" tabIndex={state.editor.selectedNodeId === guided.growth.filterComponentId ? -1 : undefined}><header><span>Which assets qualify?</span><button className="text-button" onClick={() => viewInFlow(guided.growth.filterComponentId!)}>View in Flow</button></header><label htmlFor="guided-growth-threshold">{guided.growth.lookbackBars}-day return above <span className="inline-percent"><input id="guided-growth-threshold" type="number" step="0.1" value={Number(guided.growth.threshold ?? 0) * 100} onChange={(event) => { if (event.target.value !== "") dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: guided.growth.filterComponentId!, field: "threshold", value: String(Number(event.target.value) / 100) } }); }} />%</span></label></div>}
          <div className={`summary-row ${focusClass(guided.growth.rankComponentId, "config.direction")}`} data-component-id={guided.growth.rankComponentId} data-field-path="config.direction" tabIndex={state.editor.selectedNodeId === guided.growth.rankComponentId ? -1 : undefined}><span>How should it choose?</span><strong>Highest return first</strong></div>
          <div className={`summary-row ${focusClass(guided.growth.selectionComponentId, "config.count")}`} data-component-id={guided.growth.selectionComponentId} data-field-path="config.count" tabIndex={state.editor.selectedNodeId === guided.growth.selectionComponentId ? -1 : undefined}><span>How many should it choose?</span><span>Top {guided.growth.topN} · split equally <button className="text-button" onClick={() => viewInFlow(guided.growth.selectionComponentId)}>View in Flow</button></span></div>
          <div className={`summary-row ${focusClass(guided.growth.fallbackComponentId)}`} data-component-id={guided.growth.fallbackComponentId}><span>What if there aren't enough?</span><span>Use {guided.growth.fallbackAsset} {guided.growth.fallbackComponentId && <button className="text-button" onClick={() => viewInFlow(guided.growth.fallbackComponentId!)}>View in Flow</button>}</span></div>
          {guided.growth.refreshScheduleComponentId ? <label>When should it check again?<select value={guided.growth.refreshSchedule?.toLowerCase()} onChange={(event) => dispatch({
            type: "apply_semantic_patch",
            operation: { kind: "update_schedule", componentId: guided.growth.refreshScheduleComponentId!, cadence: event.target.value as "monthly" | "quarterly" },
          })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label> : null}
        </section>
        <section className="sleeve-card safe">
          <header><div><span className="eyebrow">Portfolio sleeve</span><h2>{guided.defensive.sleeveName}</h2></div><strong>{percent(guided.defensive.allocation)}</strong></header>
          <label>What does it hold?</label><AssetChips assets={guided.defensive.assets} />
          <div className="summary-row"><span>How is it divided?</span><span>Split equally</span></div>
          {guided.defensive.refreshScheduleComponentId ? <label>When should it check again?<select value={guided.defensive.refreshSchedule?.toLowerCase()} onChange={(event) => dispatch({
            type: "apply_semantic_patch",
            operation: { kind: "update_schedule", componentId: guided.defensive.refreshScheduleComponentId!, cadence: event.target.value as "monthly" | "quarterly" },
          })}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label> : null}
        </section>
        {guided.rebalanceScheduleComponentId ? <section className="sleeve-card portfolio-card">
          <div className="summary-row"><span>When should the whole portfolio rebalance?</span><strong>{guided.rebalanceSchedule}</strong></div>
        </section> : null}
      </div>
    );
  }

  if (guided.kind === "momentum") {
    return (
      <div className="guided-view" aria-label="Guided strategy editor">
        <section className="sleeve-card">
          <header><div><span className="eyebrow">Momentum strategy</span><h2>Highest trailing return</h2></div><strong>{percent(guided.momentum.total)}</strong></header>
          <label>What can it choose from?</label>
          <AssetChips assets={guided.momentum.assets} />
          <div className="field-grid">
            <div className={`guided-field-pair ${focusClass(guided.momentum.lookbackComponentId, "config.lookback_bars")}`} data-component-id={guided.momentum.lookbackComponentId} data-field-path="config.lookback_bars" tabIndex={state.editor.selectedNodeId === guided.momentum.lookbackComponentId ? -1 : undefined}><label htmlFor="guided-lookback">How much recent history?</label>
            <input id="guided-lookback" type="number" min={1} value={guided.momentum.lookbackBars} onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: { kind: "update_component_config", componentId: guided.momentum.lookbackComponentId, field: "lookback_bars", value: Number(event.target.value) },
            })} /></div>
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
            <input id="guided-top-n" type="number" min={1} max={guided.momentum.assets.length} value={guided.momentum.topN} onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: { kind: "update_component_config", componentId: guided.momentum.selectionComponentId, field: "count", value: Number(event.target.value) },
            })} /></div>
          </div>
          <div className={`summary-row ${focusClass(guided.momentum.rankComponentId, "config.direction")}`} data-component-id={guided.momentum.rankComponentId} data-field-path="config.direction" tabIndex={state.editor.selectedNodeId === guided.momentum.rankComponentId ? -1 : undefined}><span>How should it choose?</span><span>Highest return first</span></div>
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
          <div className="summary-row"><span>When should it check again?</span><span>{guided.momentum.schedule}</span></div>
        </section>
      </div>
    );
  }

  return (
    <div className="guided-view" aria-label="Guided strategy editor">
      <section className="sleeve-card">
        <header><div><span className="eyebrow">Growth sleeve</span><h2>Growth</h2></div><strong>{percent(guided.growth.total)}</strong></header>
        <label>Assets</label>
        <AssetChips assets={guided.growth.assets} />
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
        <label>Assets</label>
        <AssetChips assets={guided.safe.assets} />
        <div className="summary-row"><span>Selection</span><span>All assets</span></div>
        <div className="summary-row"><span>Allocation</span><span>Equal Weight · {percent(guided.safe.total)}</span></div>
      </section>
    </div>
  );
}
