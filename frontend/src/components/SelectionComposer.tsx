import type { ReactNode } from "react";
import type { CanonicalStrategyV1, ValueExpression } from "../domain/canonical";
import { describeUniverse } from "../domain/valueSemantics";
import type { StrategyValueCapability } from "../structuralAuthoringApi";
import { AuthoringNumberInput } from "./AuthoringControls";
import { ValueComposer, type ValueWorkingState } from "./ValueComposer";

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
  universeEditor?: ReactNode;
  orderSummary?: string;
  orderEditor?: ReactNode;
  fallbackSummary?: string;
  fallbackEditor?: ReactNode;
  disabled?: boolean;
  onWorkingState?: (state: ValueWorkingState) => void;
  onUniverseChange?: (universeId: string) => void;
  onChange: (value: { direction: "descending" | "ascending"; count: number; shortagePolicy: "require_full" | "choose_all"; valueExpression?: ValueExpression }) => void;
}

export function SelectionComposer(props: SelectionComposerProps) {
  const emit = (patch: Partial<Pick<SelectionComposerProps, "direction" | "count" | "shortagePolicy" | "valueExpression">>) =>
    props.onChange({ direction: patch.direction ?? props.direction, count: patch.count ?? props.count, shortagePolicy: patch.shortagePolicy ?? props.shortagePolicy, valueExpression: patch.valueExpression ?? props.valueExpression });
  return <section className="selection-composer" aria-label="Selection editor">
    <header className="semantic-section-header"><div><span className="eyebrow">Selection</span><strong>Choose {props.count}</strong></div></header>
    {(props.universeEditor || (props.strategy && props.universeComponentId)) && <section className="selection-section"><span className="eyebrow">FROM</span>
      {props.universeEditor}
      {!props.universeEditor && props.universeChoices && props.universeId && props.onUniverseChange
        ? <select aria-label="Selection universe" value={props.universeId} disabled={props.disabled} onChange={(event) => props.onUniverseChange?.(event.target.value)}>{props.universeChoices.map((id) => <option key={id} value={id}>{props.strategy?.definitions.universes?.find((item) => item.id === id)?.name ?? id}</option>)}</select>
        : !props.universeEditor && props.strategy && props.universeComponentId ? <strong>{describeUniverse(props.strategy, props.universeComponentId) ?? "Explicit universe"}</strong> : null}
      {props.universeMembersEditor && <details className="semantic-subeditor"><summary>Edit universe members</summary>{props.universeMembersEditor}</details>}
    </section>}
    <section className="selection-section"><span className="eyebrow">WHERE</span><strong>{props.eligibilitySummary ?? "All candidates qualify"}</strong>{props.eligibilityEditor}</section>
    {(props.orderEditor || props.orderSummary) && <section className="selection-section"><span className="eyebrow">ORDER BY</span>{props.orderSummary && <strong>{props.orderSummary}</strong>}{props.orderEditor}</section>}
    {props.valueExpression && props.strategy && !props.orderEditor && !props.orderSummary && <section className="selection-section"><span className="eyebrow">ORDER BY</span>
      <ValueComposer expression={props.valueExpression} strategy={props.strategy} capabilities={props.capabilities} allowCandidate disabled={props.disabled}
        onWorkingState={props.onWorkingState} onChange={(valueExpression) => emit({ valueExpression })} />
    </section>}
    <section className="selection-section compact-setting"><span className="eyebrow">DIRECTION</span><select aria-label="Ranking direction" value={props.direction} disabled={props.disabled} onChange={(event) => emit({ direction: event.target.value as SelectionComposerProps["direction"] })}><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></section>
    <section className="selection-section compact-setting"><span className="eyebrow">TAKE</span><AuthoringNumberInput ariaLabel="Number of assets to take" value={props.count} minimum={1} disabled={props.disabled} onCommit={(count) => emit({ count })} /></section>
    <section className="selection-section compact-setting"><span className="eyebrow">WHEN FEWER QUALIFY</span><select aria-label="Shortage policy" value={props.shortagePolicy} disabled={props.disabled} onChange={(event) => emit({ shortagePolicy: event.target.value as SelectionComposerProps["shortagePolicy"] })}><option value="require_full">Require full count</option><option value="choose_all">Choose all eligible</option></select></section>
    <section className="selection-section"><span className="eyebrow">SELECTION FALLBACK</span><strong>{props.fallbackSummary ?? "None"}</strong>{props.fallbackEditor}</section>
  </section>;
}
