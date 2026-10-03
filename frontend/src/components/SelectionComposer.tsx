export interface SelectionComposerProps {
  direction: "descending" | "ascending";
  count: number;
  shortagePolicy: "require_full" | "choose_all";
  disabled?: boolean;
  onChange: (value: { direction: "descending" | "ascending"; count: number; shortagePolicy: "require_full" | "choose_all" }) => void;
}

export function SelectionComposer(props: SelectionComposerProps) {
  const emit = (patch: Partial<Pick<SelectionComposerProps, "direction" | "count" | "shortagePolicy">>) =>
    props.onChange({ direction: patch.direction ?? props.direction, count: patch.count ?? props.count, shortagePolicy: patch.shortagePolicy ?? props.shortagePolicy });
  return <fieldset disabled={props.disabled} className="selection-composer">
    <legend>Selection</legend>
    <label>Order<select value={props.direction} onChange={(event) => emit({ direction: event.target.value as SelectionComposerProps["direction"] })}>
      <option value="descending">Highest first</option><option value="ascending">Lowest first</option>
    </select></label>
    <label>Take<input type="number" min="1" value={props.count} onChange={(event) => emit({ count: Number(event.target.value) })} /></label>
    <label>When fewer qualify<select value={props.shortagePolicy} onChange={(event) => emit({ shortagePolicy: event.target.value as SelectionComposerProps["shortagePolicy"] })}>
      <option value="require_full">Do not select</option><option value="choose_all">Choose all eligible</option>
    </select></label>
  </fieldset>;
}
