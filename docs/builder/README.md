# RuleTrade Builder architecture

**Status: AUTHORITATIVE.** This directory is the entry point for multi-perspective Builder development.

When documents conflict, apply this order:

1. machine-readable contracts in this directory;
2. the matching Markdown contract;
3. [the living repository architecture](../architecture.md);
4. supporting specifications under `docs/architecture/`;
5. historical audits and slice documents.

Implementation is evidence of current behavior, not permission to redefine this contract. A defect remains a defect until the contract and its mapped tests are deliberately changed together.

## Core model

`CanonicalStrategyV2` is the persisted financial authority. A validated working semantic state may exist before Save, but is not a second persisted model. Each perspective owns its interaction mechanics and recoverable Draft; no perspective owns committed financial meaning.

`Perspective gesture → perspective Draft → completed typed intent → semantic validation → shared working meaning → projection → explicit Save/CAS → immutable Revision`

Test is separate: identified working state or Revision → capability and data preflight → maintained V2 lowering → LEAN → persisted Run, Result, and Evidence.

## Authoritative contracts

- [Responsibilities](../builder-responsibility-contract.md)
- [State ownership](state-ownership.md) and [machine-readable ownership](state-ownership.json)
- [Editing lifecycle](../builder-interaction-lifecycle.md)
- [Draft reconciliation](../architecture/perspective-draft-reconciliation.md)
- [Forward/reverse translation](../architecture/perspective-translation-contracts.md)
- [Architecture invariants](architecture-invariants.md)
- [Implementation audit](implementation-contract-audit.md) and [gap matrix](implementation-gap-matrix.json)
- [Contract-to-test map](contract-test-map.md) and [machine-readable map](contract-test-map.json)
- [Strategy × Perspective matrix](../../corpus/strategy-perspective-matrix.json)

## Perspective boundary

| Surface | Owns | Never owns |
|---|---|---|
| Guide | guided questions and its unfinished recipe | Blocky Draft or committed semantics |
| Flow | capital routes and React Flow layout | general logic or Blockly state |
| Blocky | logical graph and native Blockly mechanics | Flow geometry or object definitions |
| Rules | declarative financial editing | Blockly JSON or Flow nodes |
| Summary | read projection and readiness explanation | editable strategy state |
| Code | exact read-only Canonical envelope | bypass around validation |
| Structure | ownership and dependency navigation | automatic visual insertion |
| Objects | reusable definitions and stable IDs | reference placement |
| Inspector | selected-object parameters via typed operations | a second editor or authority |

Every Builder PR must list affected invariant IDs, state ownership, typed operations, capability claims, and tests.
