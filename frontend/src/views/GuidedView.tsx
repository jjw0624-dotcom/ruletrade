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
