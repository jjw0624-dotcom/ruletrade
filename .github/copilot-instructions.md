# RuleTrade repository instructions

RuleTrade owns investment meaning through:
Intent → Canonical → deterministic semantics → LEAN → Evidence.

Current documentation authority:

- `README.md`: product identity and quick start
- `docs/architecture.md`: living implemented architecture
- `docs/development.md`: setup, validation, CI, Docker/LEAN
- `docs/README.md`: current versus historical document index

Historical or superseded documents preserve rationale but do not override the
implementation or the living architecture.

## Architecture invariants

- Canonical is the authoritative Strategy representation.
- Frontend representations such as Summary, Guide, Flow, future Blocky,
  Rules, and Code must not own competing Strategy models.
- LEAN owns execution-engine mechanics.
- Decision Evidence uses exact component_id and optional field_path provenance.
- Candidate and Comparison semantics are immutable.
- Strategy adoption creates a new Revision.
- Prefer existing RuleTrade infrastructure before adding new frameworks.
- Prefer proven OSS for commodity UI/infrastructure mechanics.

## Scope discipline

Do not broaden product semantics while fixing infrastructure.
Do not introduce generic frameworks speculatively.
Do not silently change Canonical/compiler/Evidence semantics.
Do not delete apparently unused files without proving they are stale;
LEAN fixtures, scripts, generated-code tooling, and CI-only assets may not
appear in normal import graphs.

## Environment

- Python: 3.12 via uv
- Frontend Node baseline: 24
- Python dependencies: uv
- Frontend dependencies: npm
- Real execution: Docker + QuantConnect LEAN

## Validation

Use repository-owned validation entrypoints rather than duplicating commands
inside GitHub Actions.

Before completing a change, run the relevant repository validation.
For infrastructure changes, verify GitHub Actions itself after pushing.

Never claim real LEAN runtime acceptance when Docker is unavailable.
