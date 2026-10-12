# Composable semantic execution

`SemanticProgramV2` remains the sole strategy authority. The compiler now has
one bounded `composable-semantic-execution@1` typed-plan profile that connects
the already maintained temporal and cross-sectional plan nodes. It is not a
second engine and does not recognize strategy names or corpus fixture IDs.

## Deterministic pipeline

Every completed daily boundary executes in this order:

1. data and completed-clock publication;
2. Value readiness and typed Condition evaluation;
3. ordered Event detection;
4. immediate State/memory commits;
5. guard/override/primary/fallback policy choice;
6. universe resolution and weighted Score evaluation;
7. stable ranking, Selection, and Selection fallback;
8. allocation and overlap aggregation;
9. order intent;
10. sealed checkpoint/evidence emission.

An Event earlier in the Program may therefore affect a later Event and policy
at the same boundary. A completed weekly value is published only on the first
later observed trading session, preventing higher-timeframe lookahead. Unknown
Values never become zero or false inputs to ranking.

## Typed-plan boundary

`LeanTemporalPolicyTarget` may point to a typed portfolio allocation whose legs
refer to existing `LeanMomentumSelection` nodes. Selection lowering still owns
typed Value/Condition/rank/shortage behavior; the temporal layer only chooses
which allocation becomes active. Fixed multi-leg policy outputs aggregate
duplicate symbols by addition. A canonical, sorted weight signature is stored
in the existing temporal checkpoint `portfolio_target` field and is restored
before the first resumed decision.

The legacy `event-state-daily@1`, `event-state-multiclock@1`, weighted Score,
Selection/Fallback, and historical V1 paths remain intact.

## Capability honesty

Atomic feature support does not imply cross-feature support. The machine-readable
ledger is `corpus/composable-semantic-capability-matrix.json`. A combination is
marked Docker-verified only after its generated C# has run against deterministic
LEAN data and its decisions have matched the Python Program Core oracle.

This profile does not change Builder UI reachability. Arbitrary Condition-shaped
policy guards, intraday clocks, native order-ticket restoration, and generalized
multi-investment restart remain outside the proven boundary until their own
combination rows and differentials close.
