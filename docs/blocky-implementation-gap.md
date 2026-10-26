# Blocky implementation gap

## Implemented in this change

- typed anonymous AssetSet composition: filter, top/bottom N, random exact-N, random independent filter, union/intersection/difference;
- candidate-scoped values and predicates distinct from strategy-level Truth;
- aggregate Any/All/N-of-M and AssetSet count;
- deterministic random draft metadata (seed/redraw scope), native Blockly serialization, and connection tests;
- case-level corpus, reproducible classification, and conservative capability accounting.

## Explicitly not claimed

- new AssetSet primitives are not yet committed `SemanticProgramV2` operations or lowerable execution;
- no random reference/LEAN/restart evidence is claimed;
- options, pair/model/fundamental data, event calendars, execution policies, and external discretionary judgments remain outside this package;
- no numerical threshold, timeframe, provider, risk, allocation, or order policy was inferred from corpus prose.

## Measured result

The source denominator is exactly 169. New P0 grammar makes 44 fragments additionally draftable as typed compositions, while post-implementation executable/Docker-proven count remains 0 by design.
