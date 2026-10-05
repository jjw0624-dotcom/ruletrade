# Asset Workspace v0

Asset Workspace is a bounded research context inside the Strategy Builder. It answers three connected questions without becoming a second source of Strategy truth:

- **TIME:** what was known on the selected `as_of` date?
- **ASSET:** what does the maintained dataset say about this asset and its comparable peers?
- **RULE:** where does the asset or Value participate in the current Strategy or persisted historical Decision?

## Authority and lifecycle

Canonical remains authoritative for Strategy semantics. Asset Workspace reads maintained price data through the same dataset registry and evaluates metrics through the shared typed Value evaluator. Current mode may hand an explicit asset or complete Value to backend-authoritative structural authoring. Historical mode is revision- and Evidence-addressed, read-only, and never mutates current Canonical.

All price series and derived values are capped before evaluation:

```
dataset → filter observations <= as_of → select completed window → evaluate Value
```

Future observations cannot influence historical charts, current price, returns, comparison, or status.

## Product surface

The Workspace lives in the existing bounded Research surface so opening it does not replace or resize the Builder canvas. It includes:

1. maintained-data asset search with availability status;
2. a real adjusted-price chart;
3. capability-driven current price and trailing-return characteristics;
4. Strategy membership across explicit asset sets, Groups, and Universes;
5. 2–4 asset comparison at one shared `as_of`;
6. Decision-time Evidence context reached from Result → Decision → View asset;
7. **Use in Strategy** through the shared Value Composer and existing backend authoring operations.

Unavailable capability is shown as unavailable or insufficient history; the UI does not manufacture fundamentals, volume, RSI, volatility, or provider membership history.

## Current and historical modes

| Mode | Data boundary | Strategy identity | Editing |
|---|---|---|---|
| Current | chosen `as_of` | current Canonical/revision | explicit authoring actions allowed |
| Historical | Decision session | persisted run + revision + Evidence event | read-only |

## Reuse boundaries

Asset Workspace imports the shared Value Composer and consumes backend value capabilities. It does not define a separate metric grammar. Group/Universe membership changes use `update_asset_set`; a researched complete Value uses `update_condition_expression` against a selected committed Predicate or Eligibility condition. Canonical replacement then reprojects Blocky, Flow, and Rules normally.

The chart and comparison are read projections only. UI state (selected asset, compare set, chart viewport) is not persisted into Canonical.
