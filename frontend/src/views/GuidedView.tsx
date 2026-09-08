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

  if (guided.kind === "portfolio") {
    const split = `${guided.growth.allocation}/${guided.defensive.allocation}`;
    return (
      <div className="guided-view" aria-label="Guided strategy editor">
        <section className="sleeve-card portfolio-card">
          <header><div><span className="eyebrow">Portfolio</span><h2>{guided.portfolio.name}</h2></div></header>
          <label htmlFor="guided-sleeve-split">Sleeve allocation</label>
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
          <label>Universe</label><AssetChips assets={guided.growth.assets} />
          <div className="summary-row"><span>Signal</span><span>{guided.growth.lookbackBars}-day trailing return &gt; {percent(guided.growth.threshold ?? "0")}</span></div>
          <div className="summary-row"><span>Selection</span><span>Top {guided.growth.topN} · Equal Weight</span></div>
          <div className="summary-row"><span>If insufficient</span><span>Use {guided.growth.fallbackAsset}</span></div>
        </section>
        <section className="sleeve-card safe">
          <header><div><span className="eyebrow">Portfolio sleeve</span><h2>{guided.defensive.sleeveName}</h2></div><strong>{percent(guided.defensive.allocation)}</strong></header>
          <label>Universe</label><AssetChips assets={guided.defensive.assets} />
          <div className="summary-row"><span>Weighting</span><span>Equal Weight</span></div>
        </section>
      </div>
    );
  }

  if (guided.kind === "momentum") {
    return (
      <div className="guided-view" aria-label="Guided strategy editor">
        <section className="sleeve-card">
          <header><div><span className="eyebrow">Momentum strategy</span><h2>Highest trailing return</h2></div><strong>{percent(guided.momentum.total)}</strong></header>
          <label>Which assets?</label>
          <AssetChips assets={guided.momentum.assets} />
          <div className="field-grid">
            <label htmlFor="guided-lookback">Lookback (trading days)</label>
            <input id="guided-lookback" type="number" min={1} value={guided.momentum.lookbackBars} onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: { kind: "update_component_config", componentId: guided.momentum.lookbackComponentId, field: "lookback_bars", value: Number(event.target.value) },
            })} />
            {guided.momentum.filterComponentId && guided.momentum.threshold !== undefined ? <>
              <label htmlFor="guided-threshold">Minimum return (%)</label>
              <input id="guided-threshold" type="number" step="0.1" value={Number(guided.momentum.threshold) * 100} onChange={(event) => {
                if (event.target.value === "") return;
                dispatch({
                  type: "apply_semantic_patch",
                  operation: { kind: "update_component_config", componentId: guided.momentum.filterComponentId!, field: "threshold", value: String(Number(event.target.value) / 100) },
                });
              }} />
            </> : null}
            <label htmlFor="guided-top-n">How many?</label>
            <input id="guided-top-n" type="number" min={1} max={guided.momentum.assets.length} value={guided.momentum.topN} onChange={(event) => dispatch({
              type: "apply_semantic_patch",
              operation: { kind: "update_component_config", componentId: guided.momentum.selectionComponentId, field: "count", value: Number(event.target.value) },
            })} />
          </div>
          <div className="summary-row"><span>Rank</span><span>{guided.momentum.rankDirection}</span></div>
          <div className="summary-row"><span>Allocation</span><span>Equal Weight · {percent(guided.momentum.total)}</span></div>
          {guided.momentum.fallbackComponentId ? (
            <div className="summary-row">
              <label htmlFor="guided-fallback">If fewer than {guided.momentum.topN} assets qualify</label>
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
          <div className="summary-row"><span>Re-evaluate</span><span>{guided.momentum.schedule}</span></div>
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
          <label htmlFor="guided-random-count">Random Select count</label>
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
          />
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
