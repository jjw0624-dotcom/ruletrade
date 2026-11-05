# Builder state ownership

The machine-readable authority is [state-ownership.json](state-ownership.json).

| State | Owner | Persistence | Semantic hash |
|---|---|---|---|
| Persisted meaning | CanonicalStrategyV2 Revision | immutable Revision | yes |
| Working meaning | Builder semantic transaction | unsaved working copy | yes |
| Perspective Draft | owning perspective | Working Draft v3/recovery | no until committed |
| Blocky layout/connections | native Blockly | Working Draft v3 | no |
| Flow layout/viewport | React Flow | Working Draft v3 | no |
| Shared Objects | Canonical definitions; draft transaction before commit | Revision/draft | yes after commit |
| Navigation/selection | Builder shell plus native editor selection | ephemeral/recovery hint | no |
| Execution | Run service | Run/Result/Evidence | no |

Switching perspectives preserves Drafts and layout, validates only complete intent, and reprojects shared meaning. It never creates a Revision. Direct and dependency conflicts retain both Drafts and require explicit resolution; layout-only differences never conflict.
