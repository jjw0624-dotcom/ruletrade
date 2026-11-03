# V1 data migration and compatibility policy

## Non-destructive rule

Historical V1 revisions, BacktestRuns, Results and Decision Evidence are immutable facts. Migration never rewrites them. A successful migration creates a new linked V2 revision; it does not replace the source revision or regenerate historical results.

## Dispositions

| Disposition | Meaning | Action |
|---|---|---|
| Lossless | V2 meaning and maintained execution have deterministic equivalence evidence | May create a new V2 revision after explicit migration execution |
| Requires user decision | V1 meaning has an ambiguity that V2 makes explicit | Dry-run reports unresolved choices; no candidate is committed |
| Legacy read-only | Original meaning remains interpretable, but conversion equivalence is not proven | Preserve V1 reader, revision, Runs, Results and Evidence |
| Unsupported | Artifact cannot be safely interpreted or reconstructed | Preserve raw provenance and return an explicit diagnostic |

## Current status

The current converter deliberately classifies V1 strategies as `legacy_read_only`. Adjusted-price, missing-value, tie-breaking and no-ELSE semantics have not yet been proven equivalent as a complete migration contract. The dry-run API therefore produces no V2 candidate and performs no persistence writes.

This conservative classification does not prevent new V2 strategies from compiling directly. It only prevents historical facts from being silently reinterpreted.

## Dry-run contract

Each request pins:

- source revision ID;
- source semantic hash;
- legacy policy versions;
- original immutable V1 Canonical document.

The report is deterministic and idempotent. Its ID hashes the ordered revision/hash/policy inputs and the resulting disposition/diagnostics. Repeated evaluation of identical requests produces the same report. The report contains no database mutation capability.

## Promotion gates

A case may move from `legacy_read_only` to `lossless` only after semantic decision, typed plan, generated C#, Docker LEAN, Result and Decision Evidence equivalence are demonstrated with explicit tolerances. Final equity alone is insufficient.
