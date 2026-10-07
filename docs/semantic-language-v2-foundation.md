# Semantic Language v2 foundation

This is the first Profile A implementation slice. It does not reinterpret a
stored CanonicalStrategyV1: v2 is a separate ruletrade.dev/strategy/v2 document
family.

## Foundation

strategy/v2 provides:

- semantic values with dtype, quantity, unit/refinement, named axes, and clock;
- Asset/Time axis compatibility with stable domain identity;
- scalar/subset-only implicit broadcasting — no implicit Cartesian product;
- lexical Candidate binder identity;
- three-valued Truth helpers and explicit unavailable/not-evaluated states;
- history lower bounds separated from seed/checkpoint requirements;
- semantic content hashes separate from stable semantic IDs;
- evaluation/cache contexts including data, domain, binding, clock, and operator locks;
- a versioned operation catalog and dimensional capability truth;
- role validation for Predicate, Eligibility, Ranking, Allocation input, and research;
- an immutable, blocked-by-default v1 migration candidate.

## Production-connected proof

The deliberately narrow proof accepts a static Group-backed v2 Selection using
candidate trailing return or current adjusted price. After v2 validation it uses
an explicit lower_v2_to_v1 bridge and the maintained v1-to-IR-to-LeanPlan
compiler pipeline. It does not make RSI, volume, volatility, provider universes,
or generic v2 authoring production-ready.

The bridge is an adapter, not a v1 schema extension or a migration. Historical
v1 revisions remain v1 and existing Flow, Blocky, Rules, Evidence, and
Value/Condition/Selection composers retain their current semantics.

## Validation status

Repository tests establish semantic contracts and generated C# compilation.
They do not establish actual LEAN numerical parity, real provider availability,
or real-browser acceptance; those remain Profile A Work 2 gates.
