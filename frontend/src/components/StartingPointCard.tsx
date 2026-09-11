import type { StrategyExample } from "../domain/examples";

export function StartingPointCard({ point, onSelect, compact = false }: { point: StrategyExample; onSelect: (id: StrategyExample["id"]) => void; compact?: boolean }) {
  return <button className={`starting-card${compact ? " compact" : ""}`} onClick={() => onSelect(point.id)}>
    <span className="starting-kind">{point.kind === "example" ? "Example" : "Structure"}</span>
    <strong>{point.question}</strong>
    {!compact && <p>{point.description}</p>}
    <span className="starting-arrow" aria-hidden="true">→</span>
  </button>;
}
