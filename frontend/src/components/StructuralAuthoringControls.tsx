import { useEffect, useState } from "react";

import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";

export function GroupRenameControl({
  componentId,
  name,
  capabilities,
  busy,
  error,
  onRename,
}: {
  componentId: string;
  name: string;
  capabilities: StructuralAuthoringCapabilities | null;
  busy: boolean;
  error?: { message: string; detail?: string } | null;
  onRename: (name: string) => Promise<boolean>;
}) {
  const supported = capabilities?.rename_group
    && capabilities.groups.some((item) => item.component_id === componentId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  if (!supported) return <h2>{name}</h2>;
  if (!editing) {
    return <div className="structural-title">
      <h2>{name}</h2>
      <button className="text-button" onClick={() => setEditing(true)}>Rename</button>
    </div>;
  }
  return <div className="structural-edit">
    <label>Group name<input aria-label={`Rename ${name}`} value={value} maxLength={100} onChange={(event) => setValue(event.target.value)} /></label>
    <div>
      <button className="text-button" onClick={() => { setValue(name); setEditing(false); }}>Cancel</button>
      <button className="secondary-button" disabled={busy || !value.trim()} onClick={async () => {
        if (await onRename(value.trim())) setEditing(false);
      }}>{busy ? "Renaming…" : "Rename"}</button>
    </div>
    {error && <StructuralError error={error} />}
  </div>;
}

export function QualificationAuthoringControl({
  rankComponentId,
  filterComponentId,
  lookbackBars,
  threshold,
  capabilities,
  busy,
  error,
  onAdd,
  onRemove,
}: {
  rankComponentId: string;
  filterComponentId?: string;
  lookbackBars: number;
  threshold?: string;
  capabilities: StructuralAuthoringCapabilities | null;
  busy: boolean;
  error?: { message: string; detail?: string } | null;
  onAdd: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const canAdd = !filterComponentId
    && capabilities?.qualification_add_targets.includes(rankComponentId);
  const canRemove = Boolean(filterComponentId
    && capabilities?.qualification_remove_targets.includes(filterComponentId));
  if (!filterComponentId && !canAdd) return null;
  const months = Math.max(1, Math.round(lookbackBars / 21));
  return <section className="qualification-authoring" aria-label="Qualification">
    <header><div><span className="eyebrow">Which assets qualify?</span>
      {filterComponentId
        ? <strong>{months}M return &gt; {Math.round(Number(threshold ?? 0) * 100)}%</strong>
        : <strong>No qualification condition</strong>}
    </div>
    {canAdd && <button className="secondary-button" disabled={busy} onClick={() => void onAdd()}>
      {busy ? "Adding…" : "+ Add condition"}
    </button>}
    {canRemove && <button className="text-button danger" disabled={busy} onClick={() => void onRemove()}>
      {busy ? "Removing…" : "Remove condition"}
    </button>}</header>
    {filterComponentId && <p><span>Greater than</span> is fixed for this supported condition. Edit its return period and threshold below.</p>}
    {error && <StructuralError error={error} />}
  </section>;
}

function StructuralError({ error }: { error: { message: string; detail?: string } }) {
  return <div className="structural-error" role="alert"><span>{error.message}</span>
    {error.detail && <details><summary>Developer detail</summary><code>{error.detail}</code></details>}
  </div>;
}
