# Semantic Language v2 — Daily Values (Profile A Work 2)

## Boundary

Work 2 is an explicit v2 semantic and verification slice. It does not reinterpret
v1 documents, migrate v1 automatically, or expose v2 authoring. Canonical v1
behavior remains unchanged.

`DailyValueNode` is the structured source of truth. Display summaries are
projections only. The finite algebra covers:

- literal Values;
- Asset, lexical Candidate, and static Group-member observations;
- current and completed-observation History;
- trailing return, SMA, EMA, `rsi_wilder_lean_compat@1`, and realized volatility;
- explicit Time/Asset reductions with coverage policy;
- quantity-aware arithmetic;
- typed comparisons and three-valued `true / false / unknown` composition.

Named axes carry domain identity. Only scalar/subset broadcasting is implicit;
an Asset × Time Cartesian product is never invented.

## Completed-observation and history contract

Daily observations are completed closes at the decision cutoff. Missing values
are not forward-filled. The recursive planner distinguishes:

1. minimum output readiness;
2. seed anchoring;
3. checkpoint identity.

Examples:

- `history(RSI(14), 63)` needs at least 77 completed closes;
- `history(EMA(50), 63)` needs at least 112 completed closes;
- EMA and RSI still require a pinned seed/checkpoint to reproduce a stream that
  began before the replay prefix.

The lower bound is readiness, not a claim that every historical replay has the
same prior state.

## Verified adjusted-close operator profiles

The validation path is:

```
DailyValueNode
→ TypedValuePlan
→ typed LEAN probe lowering
→ generated C#
→ DockerLeanRunner
→ pinned lean-filter-data
→ RULETRADE_DAILY_VALUE JSON record
→ DailyValueObservation
→ DailyValueDifferential
```

The structured record preserves semantic ID, operator ID/version, observation
date, status, numeric value, and unavailable reason. Missing observations emit
an explicit record; absence of a log line is not treated as Unknown.

| Profile | Definition | Absolute tolerance |
| --- | --- | ---: |
| `adjusted_close@1` | completed adjusted close | 0 |
| `trailing_return@1` | (P_t / P_{t-n}) - 1) | (10^{-27}) |
| `sma@1` | arithmetic mean of the inclusive n-close window | (10^{-27}) |
| `ema@1` | LEAN EMA, SMA seed then alpha (2/(n+1)) continuing state | (10^{-18}) |
| `rsi_wilder_lean_compat@1` | initial n-change mean gain/loss, then Wilder continuing smoothing | (10^{-12}) |
| `realized_volatility@1` | sample std of n-1 simple returns from n adjusted closes, annualized by (sqrt{252}) | (10^{-12}) |

The pinned Docker differential passes for all six profiles. It also checks a
threshold-adjacent comparison outcome. EMA/RSI readiness is distinct from
checkpoint replay identity.

The fixture contains no corporate-action event that distinguishes raw from
adjusted close. The result therefore verifies adjusted-close observation
plumbing and numerical parity on this fixture, not general split/dividend
normalization parity.

## Provider contract

The repository-native `DatasetRegistry → DailyMarketSnapshot` adapter exposes
only adjusted close. It does not claim raw OHLC, volume, stable provider AssetId
mapping, snapshot/vintage `available_at`, or PIT membership. Synthetic
reference fixtures do not promote those capabilities.

## Capability truth

| Capability | Reference | LEAN differential | Authoring | Production-ready |
| --- | --- | --- | --- | --- |
| adjusted close / return / SMA / EMA / RSI profile / realized volatility | yes | verified | no | no |
| History, Time/Asset reductions, arithmetic, comparison/T-F-U | yes | no general lowering | no | no |
| raw OHLC / Volume | semantic contract only | blocked by provider | no | no |
| PIT/provider universe | semantic contract only | blocked by provider | no | no |

Capability dimensions are promoted independently. A verified runtime profile is
still not production-ready while `authoring_reachable=false`.

## Evidence-ready provenance

Every node owns a stable `semantic_id` and content hash. Plans preserve field,
operator-version, clock, axis/domain, readiness, seed, and checkpoint metadata.
Probe records round-trip the originating semantic ID and exact operator
identity. Reference cells retain unavailable reasons and observation dates;
this is the input needed by later Decision/Evidence materialization, not a
second persistence model.

## Validation commands

Normal CI runs full repository validation, generated C#/LEAN compilation, and
the pinned Docker numerical differential:

```bash
uv run python scripts/check_daily_value_lean_differential.py
```

The Docker command reuses `DockerLeanRunner`, the maintained LEAN image, and
`tests/fixtures/lean-filter-data`. Compile success and numerical parity remain
separate gates.
