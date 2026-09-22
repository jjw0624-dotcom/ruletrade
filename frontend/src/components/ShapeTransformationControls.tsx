import { useState, type FormEvent } from "react";

type ErrorState = { message: string; detail?: string } | null;

function ErrorMessage({ error }: { error: ErrorState }) {
  if (!error) return null;
  return <div className="structural-error" role="alert"><span>{error.message}</span>
    {error.detail && <details><summary>Developer detail</summary><code>{error.detail}</code></details>}
  </div>;
}

export function ChooseTransformationControl({ busy, error, onApply }: {
  busy: boolean;
  error: ErrorState;
  onApply: (lookbackObservations: number, count: number) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [lookback, setLookback] = useState(126);
  const [count, setCount] = useState(1);
  if (!open) return <section className="shape-transformation"><span className="eyebrow">Evolve strategy</span>
    <h4>Choose among assets</h4><p>Measure recent returns, rank the assets, and select the strongest.</p>
    <button className="secondary-button" onClick={() => setOpen(true)}>Add Choose step</button>
  </section>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onApply(lookback, count)) setOpen(false);
  };
  return <form className="shape-transformation" onSubmit={(event) => void submit(event)}>
    <span className="eyebrow">Add Choose step</span>
    <label>Return lookback<input type="number" min={1} value={lookback} onChange={(event) => setLookback(Number(event.target.value))} /><small>completed trading observations</small></label>
    <label>Choose<input type="number" min={1} value={count} onChange={(event) => setCount(Number(event.target.value))} /><small>strongest assets</small></label>
    <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || lookback < 1 || count < 1}>{busy ? "Updating…" : "Add Choose"}</button></div>
    <ErrorMessage error={error} />
  </form>;
}

export function FallbackTransformationControl({ busy, error, onApply }: {
  busy: boolean;
  error: ErrorState;
  onApply: (asset: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState("TLT");
  if (!open) return <section className="shape-transformation"><span className="eyebrow">When too few qualify</span>
    <h4>Add a fallback</h4><p>Choose the asset to use when the normal selection is incomplete.</p>
    <button className="secondary-button" onClick={() => setOpen(true)}>Add fallback</button>
  </section>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onApply(asset.trim().toUpperCase())) setOpen(false);
  };
  return <form className="shape-transformation" onSubmit={(event) => void submit(event)}>
    <span className="eyebrow">Fallback</span>
    <label>Fallback asset<input aria-label="Fallback asset" value={asset} maxLength={32} onChange={(event) => setAsset(event.target.value.toUpperCase())} /></label>
    <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || !asset.trim()}>{busy ? "Updating…" : "Add fallback"}</button></div>
    <ErrorMessage error={error} />
  </form>;
}

export function CooldownConstructionControl({ busy, error, onApply }: {
  busy: boolean;
  error: ErrorState;
  onApply: (duration: number) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(20);
  if (!open) return <section className="shape-transformation">
    <h4>Add Cooldown</h4><p>Wait after an asset exits before allowing it back in.</p>
    <button className="secondary-button" onClick={() => setOpen(true)}>Add Cooldown</button>
  </section>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onApply(duration)) setOpen(false);
  };
  return <form className="shape-transformation" onSubmit={(event) => void submit(event)}>
    <span className="eyebrow">Cooldown</span>
    <label>Wait after selling<input type="number" min={1} step={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><small>completed trading days</small></label>
    <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || !Number.isInteger(duration) || duration < 1}>{busy ? "Adding…" : "Add Cooldown"}</button></div>
    <ErrorMessage error={error} />
  </form>;
}

export function GrowthDefensiveTransformationControl({ busy, error, onApply }: {
  busy: boolean;
  error: ErrorState;
  onApply: (growthAllocation: string, defensiveAssets: string[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [growthPercent, setGrowthPercent] = useState(70);
  const [assets, setAssets] = useState("IEF");
  if (!open) return <section className="shape-transformation"><span className="eyebrow">Evolve portfolio</span>
    <h4>Add Growth + Defensive</h4><p>Keep this strategy as Growth and add a defensive allocation alongside it.</p>
    <button className="secondary-button" onClick={() => setOpen(true)}>Split into two groups</button>
  </section>;
  const defensive = assets.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onApply(String(growthPercent / 100), defensive)) setOpen(false);
  };
  return <form className="shape-transformation" onSubmit={(event) => void submit(event)}>
    <span className="eyebrow">Growth + Defensive</span>
    <label>Growth allocation<span className="percent-field"><input type="number" min={1} max={99} value={growthPercent} onChange={(event) => setGrowthPercent(Number(event.target.value))} />%</span></label>
    <p className="fixed-setting">Defensive receives {100 - growthPercent}%.</p>
    <label>Defensive assets<input aria-label="Defensive assets" value={assets} onChange={(event) => setAssets(event.target.value.toUpperCase())} /><small>comma-separated tickers</small></label>
    <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || growthPercent <= 0 || growthPercent >= 100 || defensive.length === 0}>{busy ? "Updating…" : "Create groups"}</button></div>
    <ErrorMessage error={error} />
  </form>;
}
