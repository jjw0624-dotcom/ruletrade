# Semantic Language v2 — Daily Values (Work 2)

## Status

This is a bounded semantic/reference slice layered on the explicit v2 boundary
from PR #44. It does not reinterpret a v1 document, alter v1 replay, or claim
that synthetic input establishes provider or LEAN numerical parity.

## Structured Values

`DailyValueNode` is a finite structured expression tree. The supported
families are:

- literal;
- explicit Asset, lexical Candidate, or static Group-members observation;
- current observation and explicit completed-observation history;
- trailing return, SMA, EMA, one named RSI profile, and realized volatility;
- explicit Time or Asset reduction;
- bounded quantity-aware arithmetic.

The persisted semantic shape is structured nodes and operands, never a display
string. Human formatting is a projection only.

## Daily contracts

- Price basis is explicit: raw OHLC and adjusted close are distinct refinements.
- Volume requires the `raw_shares` basis.
- History counts completed observations. It never forward-fills a missing
  current observation.
- Time and Asset axes carry a domain identity. Scalar/subset broadcasting is
  safe; implicit Asset × Time Cartesian broadcasting is rejected.
- Reduction owns an explicit axis and coverage policy. `require_all` does
  not silently drop unavailable members.
- EMA and RSI plans carry a seed/checkpoint requirement distinct from their
  numerical lower-bound history.
- The named RSI profile is `rsi_wilder_lean_compat@1`: its current
  implementation is a deterministic reference profile, not an assertion of
  actual LEAN runtime parity.

## Current provider boundary

The maintained `DatasetRegistry` is a price-only CSV source of adjusted
closes. It does not presently expose raw OHLC, daily volume, AssetId mapping,
provider snapshot/vintage metadata, or point-in-time membership history.
Consequently synthetic Volume/OHLC tests prove only expression semantics; they
do not make those fields provider-ready.

## Capability truth

| Operation | Parse/type/reference | Current provider | LEAN numerical parity | Authoring | Production-ready |
| --- | --- | --- | --- | --- | --- |
| Adjusted-close current / trailing return | yes | existing price CSV | existing v1 bridge/compile only | not v2-authorable | no |
| Raw OHLC | yes | no | no | no | no |
| Volume / volume reductions | yes | no | no | no | no |
| SMA / EMA | yes | no v2 data contract | no runtime differential | no | no |
| RSI Wilder profile | yes | no v2 data contract | **not run** | no | no |
| Realized volatility | yes | no v2 data contract | **not run** | no | no |
| Asset/Time reductions and arithmetic | yes | synthetic reference | no backend lowering | no | no |

Generated C# compilation validates maintained v1 compiler slices. It is not a
numerical differential for the new daily algebra.

## Work 3 prerequisites

Work 3 must connect real provider snapshots and typed v2 persistence/authoring
to a maintained backend lowering, run identical pinned data through actual
LEAN, compare numerical values and branch/selection outcomes with
operator-specific tolerances, and expose only the capabilities that pass those
gates.
