# Semantic Language v2 — Profile A Work 3

## Boundary

Canonical v2 is an explicit persisted document. Existing v1 Strategies remain
v1 and are never converted when opened. The normal Strategy/Revision repository
stores either version by its explicit `api_version`; semantic edits preserve
Strategy, Revision, and node `semantic_id` identity.

## User-facing semantic unit

The editor presents a complete Value, for example:

- Candidate's 126-observation return
- SPY's adjusted close · SMA(200)
- Candidate's adjusted close · RSI(14)
- Growth members' median return

The collapsed Value is the primary object. Opening it progressively reveals
subject, operation, and only the parameters required by that operation. Literal
Values retain quantity and unit. Default implementation details such as a scale
of one are not shown.

The reusable v2 shell is representation-independent. Predicate, Eligibility,
and ranking supply a semantic role; the component does not depend on Blocky or
Flow state.

## Capability truth

Production authoring is enabled for the adjusted-close profiles verified in
Profile A Work 2:

- current adjusted close
- trailing return
- SMA
- EMA
- RSI Wilder LEAN compatibility profile
- realized volatility

Volume, raw OHLC, and PIT membership remain visible only as unavailable
concepts. Synthetic fixtures do not promote provider capability.

## Conditions

A comparison is two complete Values and an operator. Conditions are bounded
structured trees with `ALL`, `ANY`, and `NOT`.

Safety limits:

- maximum depth: 4
- maximum children in one Boolean group: 12
- maximum total Condition nodes: 40

Candidate Values require the lexical Selection binding. A Control Predicate
must be scalar; an Asset-axis result requires an explicit reduction.

## Selection

Selection is one coherent semantic unit:

`FROM → WHERE → ORDER BY → DIRECTION → TAKE → SHORTAGE → FALLBACK`

FROM supports explicit AssetSets and static Groups. WHERE reuses the Condition
contract. ORDER BY accepts a role-valid Candidate Value. Shortage and Selection
fallback remain distinct, and neither is Control OTHERWISE.

The deterministic v2 executor evaluates Eligibility with three-valued truth,
ranks available candidates, applies shortage, and only then applies fallback.
Evidence preserves Value semantic IDs, expression hashes, operator versions,
observed values/reasons, comparison outcomes, requested/eligible/unknown
members, rank order, and the selected/fallback result.

## Authoring lifecycle

1. The user changes a complete semantic object.
2. Incomplete numeric or expression state stays local and gates Save/Test.
3. A complete edit sends one semantic intent with the expected Canonical hash.
4. The backend validates role, type, lexical binding, axis shape, provider
   capability, and tree limits.
5. Success returns a full Canonical replacement; stale responses are ignored.
6. Save appends an immutable Revision with the normal parent CAS.
7. Reopen reconstructs solely from persisted Canonical v2.

Backend rejection leaves the prior Canonical intact and keeps the local editor
error visible. No endpoint accepts an unvalidated arbitrary persisted AST
replacement as an authoring mutation.

## Representations

- Blocky summarizes the executable decision program.
- Flow summarizes capital destination/routing and keeps Selection internals in
  the Inspector.
- Rules reuse the same Value/Condition wording.
- Other representations never project an incomplete local edit as Canonical.

## Validation boundary

Repository tests cover nested conditions, lexical Candidate rejection, atomic
hash-guarded authoring, v2 API/SQLite create-save-reopen-history, generalized
Selection execution, shortage/fallback distinction, exact Evidence provenance,
and the mounted production Selection Inspector.

Real browser/WSL acceptance remains an independent post-CI gate.
