import { useMemo, useState, type FormEvent } from "react";

import type { CatalogStrategyRequest, StrategyCatalogEntry, StrategyCatalogId } from "../strategyCatalogApi";
import type { ChallengeDefinition } from "../challengeApi";

const DEFAULTS: Record<StrategyCatalogId, Record<string, string>> = {
  single_asset_periodic: {
    name: "QQQ monthly",
    asset: "QQQ",
    timeframe: "monthly",
  },
  market_regime_rotation: {
    name: "Market regime rotation",
    assets: "QQQ, VGT, SOXX, SCHG",
    trend_asset: "QQQ",
    trend_lookback: "200",
    ranking_lookback: "126",
    count: "2",
    fallback_asset: "TLT",
    timeframe: "monthly",
  },
  growth_defensive: {
    name: "Growth and Defensive",
    growth_assets: "QQQ, VGT, SOXX, SCHG",
    growth_weight: "0.7",
    defensive_asset: "IEF",
    ranking_lookback: "126",
    fallback_asset: "TLT",
    timeframe: "monthly",
  },
  weighted_top_n: {
    name: "Weighted Top N",
    assets: "QQQ, VGT, SOXX, SCHG",
    short_observations: "21",
    long_observations: "63",
    short_weight: "0.6",
    long_weight: "0.4",
    count: "3",
    timeframe: "monthly",
    missing_policy: "require_all",
  },
};

function assets(value: string): string[] {
  return value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}

export function catalogRequestFor(id: StrategyCatalogId, values: Record<string, string>): CatalogStrategyRequest {
  const common = { catalog_id: id, version: 1 as const, name: values.name.trim() };
  if (id === "single_asset_periodic") return {
    ...common, asset: values.asset.trim().toUpperCase(), timeframe: values.timeframe,
  };
  if (id === "market_regime_rotation") return {
    ...common,
    assets: assets(values.assets),
    trend_asset: values.trend_asset.trim().toUpperCase(),
    trend_lookback: Number(values.trend_lookback),
    ranking_lookback: Number(values.ranking_lookback),
    count: Number(values.count),
    fallback_asset: values.fallback_asset.trim().toUpperCase(),
    timeframe: values.timeframe,
  };
  if (id === "growth_defensive") return {
    ...common,
    growth_assets: assets(values.growth_assets),
    growth_weight: values.growth_weight,
    defensive_asset: values.defensive_asset.trim().toUpperCase(),
    ranking_lookback: Number(values.ranking_lookback),
    fallback_asset: values.fallback_asset.trim().toUpperCase(),
    timeframe: values.timeframe,
  };
  return {
    ...common,
    assets: assets(values.assets),
    short_observations: Number(values.short_observations),
    long_observations: Number(values.long_observations),
    short_weight: values.short_weight,
    long_weight: values.long_weight,
    count: Number(values.count),
    timeframe: values.timeframe,
    missing_policy: values.missing_policy,
  };
}

function TextField({ label, field, values, setValues, disabled = false }: {
  label: string;
  field: string;
  values: Record<string, string>;
  setValues: (values: Record<string, string>) => void;
  disabled?: boolean;
}) {
  return <label>{label}<input aria-label={label} disabled={disabled} value={values[field] ?? ""} onChange={(event) => setValues({ ...values, [field]: event.target.value })} /></label>;
}

function NumberField({ label, field, values, setValues, min = "1", max, step = "1" }: {
  label: string;
  field: string;
  values: Record<string, string>;
  setValues: (values: Record<string, string>) => void;
  min?: string;
  max?: string;
  step?: string;
}) {
  return <label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={values[field] ?? ""} onChange={(event) => setValues({ ...values, [field]: event.target.value })} /></label>;
}

function ScheduleField({ values, setValues, disabled = false }: { values: Record<string, string>; setValues: (values: Record<string, string>) => void; disabled?: boolean }) {
  return <label>Rebalance<select aria-label="Rebalance" disabled={disabled} value={values.timeframe} onChange={(event) => setValues({ ...values, timeframe: event.target.value })}><option value="monthly">Monthly close</option><option value="daily">Daily close</option></select></label>;
}

function constrainedDefaults(id: StrategyCatalogId, challenge?: ChallengeDefinition | null): Record<string, string> {
  const values = { ...DEFAULTS[id] };
  if (!challenge) return values;
  for (const [key, value] of Object.entries(challenge.policy.constraints.required_parameters)) {
    values[key] = String(value);
  }
  if (challenge.policy.constraints.allowed_assets.length === 1) {
    const asset = challenge.policy.constraints.allowed_assets[0];
    if (id === "single_asset_periodic") values.asset = asset;
  }
  values.name = `${challenge.kind === "learning" ? "Learning" : "Competition"} · ${challenge.title}`;
  return values;
}

export function CatalogStrategyDialog({ entries, loading, error, challenge = null, onClose, onCreate }: {
  entries: StrategyCatalogEntry[];
  loading: boolean;
  error?: string | null;
  challenge?: ChallengeDefinition | null;
  onClose: () => void;
  onCreate: (request: CatalogStrategyRequest) => void;
}) {
  const allowedEntries = useMemo(
    () => challenge ? entries.filter((item) => challenge.policy.constraints.allowed_catalog_ids.includes(item.id)) : entries,
    [challenge, entries],
  );
  const initialId = allowedEntries[0]?.id ?? entries[0]?.id ?? "single_asset_periodic";
  const [selected, setSelected] = useState<StrategyCatalogId>(initialId);
  const [values, setValues] = useState<Record<string, string>>(constrainedDefaults(initialId, challenge));
  const entry = useMemo(() => entries.find((item) => item.id === selected), [entries, selected]);
  const choose = (id: StrategyCatalogId) => { setSelected(id); setValues(constrainedDefaults(id, challenge)); };
  const required = challenge?.policy.constraints.required_parameters ?? {};
  const allowedAssets = challenge?.policy.constraints.allowed_assets ?? [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values.name?.trim()) return;
    onCreate(catalogRequestFor(selected, values));
  };

  return <div className="modal-backdrop" role="presentation"><form className="creation-picker catalog-strategy-dialog" aria-labelledby="catalog-title" onSubmit={submit}>
    <header><div><span className="eyebrow">{challenge ? "Problem-constrained Rules strategy" : "Rules strategy"}</span><h2 id="catalog-title">{challenge ? challenge.title : "Choose a tested strategy shape"}</h2><p>{challenge ? "The problem policy limits the available strategy family and locks required inputs before evaluation." : "Set the allowed parameters now. The result is saved as a normal Strategy and can use every research test."}</p></div><button type="button" className="close-button" aria-label="Close" onClick={onClose}>×</button></header>
    <section className="picker-group"><h3>Strategy rule</h3><div>{allowedEntries.map((item) => <button type="button" aria-pressed={selected === item.id} key={item.id} onClick={() => choose(item.id)}><span><strong>{item.name}</strong><small>{item.description}</small></span><span>{selected === item.id ? "Selected" : "Choose"}</span></button>)}</div></section>
    <section className="create-dialog catalog-parameter-form">
      <span className="eyebrow">Parameters · catalog v{entry?.version ?? 1}</span>
      <TextField label="Strategy name" field="name" values={values} setValues={setValues} />
      {selected === "single_asset_periodic" && <>{allowedAssets.length > 0 ? <label>Asset<select aria-label="Asset" value={values.asset} onChange={(event) => setValues({ ...values, asset: event.target.value })}>{allowedAssets.map((asset) => <option key={asset} value={asset}>{asset}</option>)}</select></label> : <TextField label="Asset" field="asset" values={values} setValues={setValues} />}<ScheduleField values={values} setValues={setValues} disabled={Object.hasOwn(required, "timeframe")} /></>}
      {selected === "market_regime_rotation" && <><TextField label="Candidate assets (comma separated)" field="assets" values={values} setValues={setValues} /><TextField label="Trend asset" field="trend_asset" values={values} setValues={setValues} /><NumberField label="Trend observations" field="trend_lookback" values={values} setValues={setValues} min="2" max="2000" /><NumberField label="Ranking observations" field="ranking_lookback" values={values} setValues={setValues} min="2" max="2000" /><NumberField label="Top N" field="count" values={values} setValues={setValues} min="1" max="100" /><TextField label="Fallback asset" field="fallback_asset" values={values} setValues={setValues} /><ScheduleField values={values} setValues={setValues} /></>}
      {selected === "growth_defensive" && <><TextField label="Growth assets (comma separated)" field="growth_assets" values={values} setValues={setValues} /><NumberField label="Growth share" field="growth_weight" values={values} setValues={setValues} min="0.01" max="0.99" step="0.01" /><TextField label="Defensive asset" field="defensive_asset" values={values} setValues={setValues} /><NumberField label="Ranking observations" field="ranking_lookback" values={values} setValues={setValues} min="2" max="2000" /><TextField label="Shortage fallback" field="fallback_asset" values={values} setValues={setValues} /><ScheduleField values={values} setValues={setValues} /></>}
      {selected === "weighted_top_n" && <><TextField label="Candidate assets (comma separated)" field="assets" values={values} setValues={setValues} /><NumberField label="Short observations" field="short_observations" values={values} setValues={setValues} min="2" max="2000" /><NumberField label="Long observations" field="long_observations" values={values} setValues={setValues} min="2" max="2000" /><NumberField label="Short weight" field="short_weight" values={values} setValues={setValues} min="0.01" step="0.01" /><NumberField label="Long weight" field="long_weight" values={values} setValues={setValues} min="0.01" step="0.01" /><NumberField label="Top N" field="count" values={values} setValues={setValues} min="1" max="100" /><ScheduleField values={values} setValues={setValues} /><label>Missing data<select aria-label="Missing data" value={values.missing_policy} onChange={(event) => setValues({ ...values, missing_policy: event.target.value })}><option value="require_all">Require every signal</option><option value="renormalize_available">Use available signals</option></select></label></>}
      {challenge && <section className="empty-state" aria-label="Applied challenge constraints"><strong>Policy v{challenge.policy.version} applied</strong><p>Allowed assets: {allowedAssets.join(", ") || "catalog default"} · Required inputs are locked.</p></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={loading || !values.name?.trim()}>{loading ? "Creating…" : "Create and save strategy"}</button></div>
    </section>
  </form></div>;
}
