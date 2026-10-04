import type { ReactNode } from "react";
import type { CanonicalStrategyV1, ValueExpression } from "../domain/canonical";
import { describeUniverse } from "../domain/valueSemantics";
import type { StrategyValueCapability } from "../structuralAuthoringApi";
import { ValueComposer } from "./ValueComposer";

export interface SelectionComposerProps {
  direction: "descending" | "ascending";
  count: number;
  shortagePolicy: "require_full" | "choose_all";
  valueExpression?: ValueExpression;
  strategy?: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  universeComponentId?: string;
  universeId?: string;
  universeChoices?: string[];
  eligibilitySummary?: string;
  eligibilityEditor?: ReactNode;
  universeMembersEditor?: ReactNode;
  disabled?: boolean;
  onUniverseChange?: (universeId: string) => void;
  onChange: (value: { direction: "descending" | "ascending"; count: number; shortagePolicy: "require_full" | "choose_all"; valueExpression?: ValueExpression }) => void;
}

export function SelectionComposer(props: SelectionComposerProps) {
  const emit = (patch: Partial<Pick<SelectionComposerProps, "direction" | "count" | "shortagePolicy" | "valueExpression">>) =>
    props.onChange({ direction: patch.direction ?? props.direction, count: patch.count ?? props.count, shortagePolicy: patch.shortagePolicy ?? props.shortagePolicy, valueExpression: patch.valueExpression ?? props.valueExpression });
  return <fieldset disabled={props.disabled} className="selection-composer">
    <legend>Choose assets</legend>
    {props.strategy && props.universeComponentId && <section className="selection-section"><span className="eyebrow">From</span>
      {props.universeChoices && props.universeId && props.onUniverseChange
        ? <select aria-label="Selection universe" value={props.universeId} onChange={(event) => props.onUniverseChange?.(event.target.value)}>{props.universeChoices.map((id) => <option key={id} value={id}>{props.strategy?.definitions.universes?.find((item) => item.id === id)?.name ?? id}</option>)}</select>
        : <strong>{describeUniverse(props.strategy, props.universeComponentId) ?? "Explicit universe"}</strong>}
      {props.universeMembersEditor}
    </section>}
    <section className="selection-section"><span className="eyebrow">Where</span><strong>{props.eligibilitySummary ?? "All candidates qualify"}</strong>{props.eligibilityEditor}</section>
    {props.valueExpression && props.strategy && <section className="selection-section"><span className="eyebrow">Order by</span><ValueComposer expression={props.valueExpression} strategy={props.strategy} capabilities={props.capabilities} allowCandidate disabled={props.disabled} onChange={(valueExpression) => emit({ valueExpression })} /></section>}
    <label>Direction<select value={props.direction} onChange={(event) => emit({ direction: event.target.value as SelectionComposerProps["direction"] })}><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></label>
    <label>Take<input type="number" min="1" value={props.count} onChange={(event) => emit({ count: Number(event.target.value) })} /></label>
    <label>When fewer qualify<select value={props.shortagePolicy} onChange={(event) => emit({ shortagePolicy: event.target.value as SelectionComposerProps["shortagePolicy"] })}><option value="require_full">Require full count</option><option value="choose_all">Choose all eligible</option></select></label>
    <p className="fixed-setting">Selection fallback is configured separately from shortage policy and Control OTHERWISE.</p>
  </fieldset>;
}
