import { useEffect, useState } from "react";

import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";

export function AuthoringNumberInput({ value, minimum, maximum, step, disabled, ariaLabel, onCommit }: { value: number; minimum?: number; maximum?: number; step?: number; disabled?: boolean; ariaLabel?: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const numeric = Number(draft);
    if (Number.isFinite(numeric) && numeric !== value) onCommit(numeric);
    else setDraft(String(value));
  };
  return <input aria-label={ariaLabel} type="number" min={minimum} max={maximum} step={step} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

export function AssetMembershipEditor({ authoring, assetSetId, assets, question = "What can it choose from?" }: { authoring: StructuralAuthoringController; assetSetId: string; assets: string[]; question?: string }) {
  const [ticker, setTicker] = useState("");
  const available = authoring.capabilities?.asset_set_targets.some((item) => item.asset_set_id === assetSetId);
  if (!available) return null;
  const update = (next: string[]) => void authoring.apply({ kind: "update_asset_set", asset_set_id: assetSetId, assets: next });
  const add = () => { if (ticker.trim()) { update([...assets, ticker]); setTicker(""); } };
  return <div className="asset-membership"><label>{question}</label><div className="asset-chips">{assets.map((asset) => <span key={asset}>{asset}{assets.length > 1 && <button type="button" aria-label={`Remove ${asset}`} disabled={authoring.status === "applying"} onClick={() => update(assets.filter((item) => item !== asset))}>×</button>}</span>)}</div><div className="asset-add"><label className="sr-only" htmlFor={`asset-${assetSetId}`}>Ticker symbol</label><input id={`asset-${assetSetId}`} value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="Add ticker"/><button type="button" className="secondary-button" disabled={authoring.status === "applying"} onClick={add}>Add asset</button></div><small>A valid ticker can be saved here. Backtests currently run only with the built-in datasets and symbols they contain.</small></div>;
}

export function LookbackControl({ authoring, componentId, value, id }: { authoring: StructuralAuthoringController; componentId: string; value: number; id: string }) {
  const capability = authoring.capabilities?.lookback_targets.find((item) => item.component_id === componentId);
  const presets = [21, 63, 126, 252];
  const selected = presets.includes(value) ? String(value) : "custom";
  if (!capability) return null;
  const update = (lookback_bars: number) => void authoring.apply({ kind: "update_lookback", component_id: componentId, lookback_bars });
  return <div className="lookback-control"><label htmlFor={`${id}-preset`}>Return period</label><select id={`${id}-preset`} value={selected} disabled={authoring.status === "applying"} onChange={(event) => { if (event.target.value !== "custom") update(Number(event.target.value)); }}><option value="21">About 1 month</option><option value="63">About 3 months</option><option value="126">About 6 months</option><option value="252">About 12 months</option><option value="custom">Custom…</option></select>{selected === "custom" && <label>Completed trading observations<AuthoringNumberInput value={value} minimum={capability.minimum} disabled={authoring.status === "applying"} onCommit={update}/></label>}<small>{value} completed trading observations—not calendar days.</small></div>;
}

export function SleeveAllocationEditor({ authoring, groups }: { authoring: StructuralAuthoringController; groups: Array<{ id: string; label: string; componentId: string; allocation: string }> }) {
  const [values, setValues] = useState(groups.map((group) => String(Number(group.allocation) * 100)));
  useEffect(() => setValues(groups.map((group) => String(Number(group.allocation) * 100))), [groups]);
  const capability = authoring.capabilities?.sleeve_allocation_targets.find((item) => item.sleeves.length === groups.length && groups.every((group) => item.sleeves.some((sleeve) => sleeve.component_id === group.componentId)));
  if (!capability) return null;
  const total = values.reduce((sum, value) => sum + Number(value), 0);
  return <div className="allocation-editor">{groups.map((group, index) => <label key={group.id}>{group.label}<span className="percent-field"><input type="number" min={0.01} max={100} step="0.1" value={values[index]} onChange={(event) => setValues(values.map((value, current) => current === index ? event.target.value : value))}/>%</span></label>)}<div className={total === 100 ? "split-total valid" : "split-total invalid"} role="status">Total {total}% {total === 100 ? "✓" : "— must equal 100%"}</div><button className="primary-button" disabled={total !== 100 || authoring.status === "applying"} onClick={() => void authoring.apply({ kind: "update_sleeve_allocations", allocations: groups.map((group, index) => ({ component_id: group.componentId, allocation: String(Number(values[index]) / 100) })) })}>Apply split</button><small>Both values update together. Invalid totals do not change the strategy.</small></div>;
}

export function ScheduleControl({ authoring, label, componentId }: { authoring: StructuralAuthoringController; label: string; componentId: string }) {
  const capability = authoring.capabilities?.schedule_targets.find((item) => item.component_id === componentId);
  if (!capability) return null;
  return <label>{label}<select value={capability.cadence} disabled={authoring.status === "applying"} onChange={(event) => { const choice = capability.choices.find((item) => item.cadence === event.target.value); if (choice) void authoring.apply({ kind: "update_schedule", component_id: componentId, cadence: choice.cadence, day: choice.requires_day ? (capability.day ?? choice.default_day) : null }); }}>{capability.choices.map((choice) => <option key={choice.cadence} value={choice.cadence}>{choice.cadence[0].toUpperCase() + choice.cadence.slice(1)}</option>)}</select></label>;
}

export function CooldownControl({ authoring, componentId, value }: { authoring: StructuralAuthoringController; componentId: string; value: number }) {
  const capability = authoring.capabilities?.cooldown_duration_targets.find((item) => item.component_id === componentId);
  if (!capability) return null;
  return <label>Wait after selling<AuthoringNumberInput value={value} minimum={capability.minimum} disabled={authoring.status === "applying"} onCommit={(duration) => void authoring.apply({ kind: "update_cooldown_duration", component_id: componentId, duration })}/><small>Completed trading days</small></label>;
}
