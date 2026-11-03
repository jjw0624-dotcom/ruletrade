# CI architecture

## Why the previous workflow was insufficient

The previous `Repository validation` job bundled Python, Vitest, TypeScript, production build, lint, shell checks and generated drift. The previous `Generated C# / LEAN compile` job also ran every Docker differential. A failure identified a large bucket rather than a product contract, and a passing bucket did not prove production API or browser closure. Branch filters also named obsolete feature branches.

## Contract jobs

| Job | Product question | Frequency |
|---|---|---|
| Static & Contract | Do types, build, schemas, locks, generated artifacts and evidence ledgers agree? | Every PR/push |
| Unit & Semantic | Do Python/frontend units, validation, CAS, drafts, evaluator and authoring contracts hold? | Every PR/push |
| Perspective Consistency | Do projections share semantic identity and preserve save/reopen/unsupported meaning? | Every PR/push |
| LEAN Compilation | Do maintained fixtures lower and compile against LEAN? | Every PR/push |
| Docker Differential | Does each maintained profile match its deterministic oracle? | Matrix on every PR/push initially |
| Production API Contract | Do persistence, status, error and retrieval contracts hold? | Every PR/push |
| Real Browser E2E | Does a real Chrome instance exercise the production Builder? | Every PR/push |
| Full Regression / Nightly | Does the complete suite remain reproducible outside a PR timeout budget? | Nightly/manual |

The Production API job is intentionally called a contract until the engine PR adds a Docker-backed saved-V2 execution journey. The capability matrix records this as `PARTIAL`; CI naming must not imply otherwise.

## Evidence and diagnostics

- The capability ledger is validated for complete dimensions, valid status vocabulary, exact six representative families, existing evidence paths and evidence symbols.
- Docker profiles run in three named matrix shards so a failure identifies the semantic family without downloading the large LEAN image nine separate times.
- LEAN build/log artifacts are retained on failure.
- Browser screenshots and trace artifacts are retained on every run.
- A required-check aggregator depends on all contract jobs; no broad `continue-on-error` is used.
- Nightly retains full diagnostics and runs the complete repository check plus every Docker profile.

## Evolution gate

The current custom CDP browser runner is real-browser evidence but not yet the requested full product journey. A later E2E PR may adopt Playwright after dependency/maintenance review. Until then, the evidence matrix remains `PARTIAL`, never `PASS`.

