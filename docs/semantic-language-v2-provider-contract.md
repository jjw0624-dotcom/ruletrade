# Semantic Language v2 — Maintained dataset provider boundary

DatasetDailySnapshotProvider is the one repository-native adapter between the
maintained CSV DatasetRegistry and a v2 DailyMarketSnapshot.

## What it provides

- completed daily **adjusted close** values;
- static caller-supplied domains;
- a deterministic content-derived snapshot identity;
- an explicit daily-close clock and dataset-date calendar contract.

It deliberately does **not** infer availability timestamps, asset identifiers,
point-in-time membership, raw OHLC, raw close, or volume. Those are reported
as unavailable in DailyDatasetContract, rather than being manufactured from
the adjusted-close CSV.

The adapter is suitable for reference evaluation of adjusted-close daily
expressions. It does not make the expressions backend-lowerable, authorable,
or numerically verified against a LEAN runtime. Those remain separate
capability gates.
