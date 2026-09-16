# RuleTrade documentation

This directory contains current subsystem contracts and historical records from
RuleTrade's incremental vertical slices.

## Documentation authority

Read documentation in this order:

1. [Repository README](../README.md) — current product identity and quick start.
2. [Living architecture](architecture.md) — authoritative implemented system architecture.
3. [Development and validation](development.md) — setup, CI, Codespaces, Docker/LEAN, and WSL.
4. Current subsystem documents — detailed contracts linked below.

Documents marked **Historical** or **Superseded** preserve rationale and
acceptance evidence. They are not sources of current product scope or
architecture when they conflict with code or the living architecture.

## Document status

| Document | Status | Role |
| --- | --- | --- |
| `README.md` | CURRENT | Documentation authority and complete status index |
| `architecture.md` | CURRENT | Living end-to-end architecture and ownership |
| `development.md` | CURRENT | Setup, validation, CI, Codespaces, Docker/LEAN |
| `canonical-v1.md` | CURRENT | Canonical and Registry foundation |
| `compiler-foundation.md` | CURRENT | Compiler authority and supported slices |
| `strategy-ir.md` | CURRENT | IR and lowering architecture |
| `lean-compiler-v0.md` | CURRENT | LEAN backend and generated-C# details |
| `strategy-revision-persistence.md` | CURRENT | Strategy and immutable Revision contract |
| `backtest-run-persistence.md` | CURRENT | Persisted Run lifecycle and provenance |
| `decision-evidence-v1-1.md` | CURRENT | Current Evidence v2 wire/persistence contract |
| `evidence-harvest.md` | CURRENT | Exact Rule → persisted Result reuse |
| `candidate-change.md` | CURRENT | Candidate v0 semantics |
| `comparisons.md` | CURRENT | Comparison semantics and lineage |
| `market-data-v0.md` | CURRENT | Local LEAN-format market-data contract |
| `market-data-preflight-ux.md` | CURRENT | Product preflight behavior |
| `integrated-research-workbench.md` | CURRENT | Shared Builder/Activity/Research behavior |
| `repository-engineering.md` | CURRENT | Artifact and repository validation policy |
| `authoring-breadth-audit.md` | HISTORICAL | Earlier breadth audit; later authoring superseded conclusions |
| `backend-observability-audit.md` | HISTORICAL | Pipeline measurement rationale after Comparison v0 |
| `final-frontend-mvp-cohesion.md` | HISTORICAL | Pre-workbench frontend cohesion record |
| `mvp-frontend-api-gaps.md` | HISTORICAL | Earlier gap analysis, many gaps since delivered |
| `analysis-flow-ux-v2.md` | SUPERSEDED | Predates production conceptual xyflow Flow |
| `backtest-run-frontend.md` | SUPERSEDED | Predates integrated Research and Evidence |
| `candidate-comparison-frontend.md` | SUPERSEDED | Predates integrated Comparison and Keep |
| `current-mvp-architecture.md` | SUPERSEDED | Replaced by `architecture.md` |
| `decision-evidence.md` | SUPERSEDED | Earlier Evidence version; use Evidence v2 document |
| `editor-lean-backtest.md` | SUPERSEDED | Transient editor path is no longer the primary product flow |
| `frontend-product-spec-consolidation.md` | SUPERSEDED | Intermediate product specification |
| `my-strategies-frontend.md` | SUPERSEDED | Predates Runs and integrated research |
| `product-entry-shell.md` | SUPERSEDED | Predates the current direct persisted-Strategy entry |
| `strategy-builder-workspace.md` | SUPERSEDED | Predates integrated Activity/Research workspace |
| `structural-authoring-v0.md` | SUPERSEDED | Predates later valid-shape transformations and current Flow |

Status describes documentation authority, not whether the historical work was
valuable. No historical record should override the current implementation.
