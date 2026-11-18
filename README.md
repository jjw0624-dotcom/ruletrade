# RuleTrade

RuleTrade is an investment-strategy research workbench. A user can start from a
backend-owned example or starting structure, edit one authoritative Strategy,
test it through QuantConnect LEAN, inspect persisted decision evidence, try a
narrow experimental change, compare behavior, and keep or discard that change.

The implemented MVP loop is:

```text
Discover an idea
  → ordinary persisted Strategy
  → Strategy Builder (Summary / Guide / Flow)
  → edit and save an immutable Revision
  → Test through LEAN
  → persisted BacktestRun + Decision Evidence
  → Research: Result, Decision, Why / Why-not
  → exact Result ↔ Strategy rule navigation
  → Candidate Run
  → Comparison
  → Keep or Discard
  → Test the current Strategy again
```

## The current system

- `CanonicalStrategyV2` is the sole current authored and persisted Strategy truth.
  V1 remains only as a legacy compatibility path during migration.
- Summary, Guide, and Flow are synchronized representations inside one shared
  Strategy Builder; they do not own separate Strategy documents.
- Flow uses xyflow for canvas mechanics. Nodes, edges, selection, and visual
  positions are projections or UI state, never the Strategy model.
- Saving creates immutable Revisions with optimistic stale-write protection.
- The compiler validates Canonical, lowers it through Strategy IR and LeanPlan,
  generates C#, and delegates execution mechanics to QuantConnect LEAN.
- Successful saved Tests persist an immutable BacktestRun, normalized Result,
  provenance, timings, and structured Decision Evidence.
- Evidence identifies its source with exact `component_id` and optional
  `field_path`, enabling Result → Rule and Rule → historical Result navigation.
- A Candidate is an immutable typed experiment over a base Revision. A
  Comparison relates its Original and Candidate Runs without rerunning LEAN.
- Keep/adoption creates or reuses the intended new immutable Revision. Until
  Keep, Candidate research does not mutate the persisted Strategy.

Read [the living architecture](docs/architecture.md) for current ownership and
data flow. [The documentation index](docs/README.md) distinguishes current
contracts from historical implementation records.

Builder changes must also follow the
[Builder architecture constitution](docs/builder/README.md), the authoritative
entry point for perspective responsibilities, state ownership, editing
lifecycle, invariants, and their executable test map.

## MVP scope

The current Builder supports a constrained V2 semantic language through
perspective-specific Guide, Flow, Blocky, and Rules authoring. Summary and Code
remain read-oriented. A capability is advertised only when its production
gesture, typed V2 operation, validation, reprojection, persistence, and claimed
execution evidence are connected. The Builder is not an arbitrary graph editor.

The active delivery sequence is the
[fixed-strategy MVP completion plan](docs/mvp-completion-plan.md). Strategy
creation is temporarily narrowed to a versioned catalog and Rules-oriented
parameter forms so Detail BT, Hidden BT, robustness, random baselines, Forward,
Learning, and Competition can be completed on the existing Revision and LEAN
foundation. The [V2 Builder completion baseline](docs/v2-builder-completion-baseline.md)
records the proven multi-perspective contract and the separately resumed Builder
track.

The general-purpose Builder grammar, arbitrary wiring, generic unrestricted
Group CRUD, unrestricted nested boolean construction, editable arbitrary Code,
and embedded AI authoring are deferred to the independent Builder track.
Optimization beyond bounded Detail BT, production Replay, broker execution,
authentication/multi-user support, and Community features remain outside the
fixed-strategy MVP.

## Development quick start

The supported development baseline is Python 3.12, Node 24, `uv`, and npm with
the committed lockfiles.

```bash
uv python install 3.12
make bootstrap
```

Run the backend and frontend in separate terminals:

```bash
make api
make frontend
```

Open `http://127.0.0.1:5173`. API documentation is available at
`http://127.0.0.1:8000/docs`.

Repository validation entry points are:

```bash
make check-fast          # Python/frontend tests and TypeScript
make check               # full repository validation used by CI
make check-lean-generate # generate every maintained compiler-slice C# file
make check-lean          # generate and compile every slice against Docker LEAN
```

See [Development and validation](docs/development.md) for Codespaces, CI,
Docker/LEAN, real-market-data diagnostics, and WSL browser acceptance.

## Legacy simple strategy path

The repository retains its original YAML/simple-strategy path, the `bt`
adapter, CLI commands, synthetic CSV data, and compatibility HTTP endpoints.
They remain tested and useful as a small independent vertical slice, but they
are not the defining architecture of the current Canonical/LEAN product.

```bash
ruletrade validate examples/monthly_dca.yaml
ruletrade backtest examples/monthly_dca.yaml --dataset synthetic_prices --data-dir data
```

The current Strategy Builder and Research workbench use Canonical, immutable
Revisions, LEAN, BacktestRuns, and Decision Evidence as described above.

## Current reference documents

- [Living system architecture](docs/architecture.md)
- [Fixed-strategy MVP completion plan](docs/mvp-completion-plan.md)
- [V2 Builder completion baseline](docs/v2-builder-completion-baseline.md)
- [Builder architecture constitution](docs/builder/README.md)
- [Development and validation](docs/development.md)
- [Canonical Strategy v1](docs/canonical-v1.md)
- [Compiler foundation](docs/compiler-foundation.md)
- [Strategy IR](docs/strategy-ir.md)
- [Strategy and immutable Revision persistence](docs/strategy-revision-persistence.md)
- [Persistent BacktestRun](docs/backtest-run-persistence.md)
- [Decision Evidence v2](docs/decision-evidence-v1-1.md)
- [Evidence Harvest: Rule → Result](docs/evidence-harvest.md)
- [Candidate Change v0](docs/candidate-change.md)
- [Comparison v0](docs/comparisons.md)
- [Market Data v0](docs/market-data-v0.md)
- [Integrated Strategy research workbench](docs/integrated-research-workbench.md)

Historical vertical-slice and design documents are retained intentionally and
marked non-authoritative in the [documentation index](docs/README.md).

## Diagnostics

After installation, run:

```bash
./scripts/doctor.sh
```

It creates `ruletrade-diagnostic.txt` containing environment versions and test
output, not credentials. Review it before sharing.
