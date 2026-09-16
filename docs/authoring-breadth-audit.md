# Authoring breadth audit

> **Status: HISTORICAL.** This audit predates later structural transformations
> and the current Builder. Retain it as rationale; use
> [the living architecture](architecture.md) for current authoring behavior.

This document records the user-meaningful editing surface available from the current
`CanonicalStrategyV1`, builtin Primitive Registry, validation boundary, compiler, and LEAN runner.
It is an implementation audit, not a proposal for new strategy semantics.

## Capability matrix

Legend: **A** Guided exposes it, **B** Flow exposes it, **C** supported but not exposed,
**D** represented but not safely mutable by the current targeted semantic operations,
**E** absent from current product semantics.

| Capability | Runtime/validation truth | Guided | Flow | Class after this PR |
| --- | --- | --- | --- | --- |
| Asset-set membership | Non-empty, normalized, unique symbols; named set references | Add/remove | Add/remove | A+B |
| Trailing-return lookback | Positive integer `lookback_bars` | Presets + exact observations | Same | A+B |
| Filter operator | Registry and compiler allow strict `gt` only | Fixed user-language text | Fixed user-language text | A+B; alternatives E |
| Filter threshold | Percentage | Editable percent | Editable percent | A+B |
| Ranking source/metric | Connected to the existing trailing-return score pipeline | Explained, fixed | Explained, fixed | D |
| Ranking direction | Registry allows `descending` only | Strongest first | Strongest first | A+B; weakest E |
| Top N | Positive integer | Editable | Editable | A+B |
| Weighting method | `equal_weight@1` only | Explained, fixed | Explained, fixed | A+B; alternatives E |
| Equal-weight total | Positive percentage up to 1 | Displayed for simple strategies | Displayed | D outside sleeve patch |
| Fallback destination | Reference to an existing named asset set | Editable when present | Editable when present | A+B |
| Cooldown duration | Positive integer | Editable when present | Editable when present | A+B |
| Cooldown unit | `trading_days` only | Fixed intent text | Fixed intent text | A+B; alternatives E |
| Evaluation schedule | Existing Daily/Monthly/Quarterly event component | Daily/Monthly/Quarterly editable | Same | A+B; arbitrary cadence E |
| Sleeve refresh schedule | Entrypoint-owned event component | Editable when present | Editable on Group/Choose | A+B |
| Portfolio rebalance schedule | Entrypoint-owned event component | Editable when present | Editable on Portfolio | A+B |
| Sleeve allocation | Two existing sleeves, positive values summing to 1 | Atomic free-form percentages | Same shared control | A+B |
| Random selection count | Positive integer | Editable in Golden example | Editable in Choose | A+B |
| Random resampling | `once` or `per_event` | Editable | Editable in Choose | A+B |
| Portfolio/sleeve names | Canonical config strings | Display only | Display only | D |
| Group/Choose/Split CRUD | No targeted graph-authoring contract | Not offered | Not offered | D |
| Free connection/reconnection | Graph can represent connections, but no conceptual atomic edit contract | Not offered | Not offered | D |
| Cash destination | No current strategy primitive/contract | Not offered | Not offered | E |

The editors intentionally do not infer broader support from Canonical expression enums. A value is
classified as editable only when the current registry validation and compiler/runtime path support it.

## Market-data availability

Canonical asset sets accept normalized symbols matching the backend `Symbol` contract. This means a
strategy can express a ticker without guaranteeing that a Backtest can execute it.

The current `BacktestConfig.dataset_id` permits exactly:

- `golden-synthetic`
- `filter-synthetic`
- `cooldown-synthetic`

`DockerLeanRunner` maps these IDs to repository test-fixture directories and rejects every other ID.
The selected fixture is copied into the LEAN container; there is no brokerage, download, cloud data,
or general historical market-data provider integration. A run fails when the chosen fixture lacks a
required symbol or period. Dataset IDs remain hidden from the ordinary frontend.

Therefore:

- users can author any symbol accepted by Canonical validation;
- only symbols and dates covered by the selected built-in synthetic fixture can run successfully;
- adding a syntactically valid ticker may make the subsequent Backtest fail safely;
- the frontend warns at asset entry instead of claiming availability it cannot verify.

### MVP follow-up recommendation

Before presenting unrestricted ticker entry as a complete product capability, add a backend-owned
market-data availability contract: supported symbols, covered date ranges, source identity, and a
preflight response for a proposed run. This is a data-platform requirement, not a frontend ticker
validation rule.

## Remaining authoring boundaries

Backend-supported but not safely authorable through current targeted operations:

- changing which score pipeline supplies ranking;
- changing names of portfolio/sleeve concepts;
- mutating simple-strategy equal-weight totals as a coordinated allocation;
- constructing or deleting component pipelines and their typed connections.

High-value semantics genuinely absent from the current Registry include alternative filter operators,
alternative ranking directions, weighting methods beyond equal weight, Cash fallback, and arbitrary
calendar schedules. These remain follow-up product decisions rather than frontend options.
