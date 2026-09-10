# Strategy and immutable Revision persistence

This slice adds the first durable product identity above the compiler. It does not persist runs,
compiler artifacts, editor layout, or decision evidence.

## Domain contract

- A **Strategy** is a long-lived user-facing identity with its own name.
- A **Revision** is an immutable snapshot of one validated `CanonicalStrategyV1` source document.
- An **editor working copy** is client-side mutable state loaded from a Revision. It is never stored
  as a Revision until the user explicitly saves it.
- Renaming a Strategy changes only the Strategy row. Historical Canonical metadata remains exactly
  as saved in each Revision.

Creating a Strategy atomically creates Revision 1 and assigns it as current. Saving a changed
working copy atomically inserts a child Revision and advances `current_revision_id`. The caller must
provide the Revision from which the working copy was opened. A mismatch returns a stale-revision
conflict and writes nothing.

Submitting the exact same validated source snapshot as the current Revision is idempotent: the API
returns the current Revision with `created=false`, creates no row, and does not change `updated_at`.
The stale-parent check happens first, so a stale editor never receives a false no-op success.

## Storage choice and schema

The MVP uses Python's standard-library `sqlite3` with one file. This is real transactional,
process-reopenable persistence and fits the current single-service local/container deployment. It
adds no dependency or ORM. In-memory dictionaries, local JSON documents, and browser storage are
not authoritative.

Schema version 1 introduced these two tables using `PRAGMA user_version`:

| Table | Stored fields |
| --- | --- |
| `strategies` | `id`, `name`, `created_at`, `updated_at`, `current_revision_id`, `archived_at` |
| `strategy_revisions` | `id`, `strategy_id`, `parent_revision_id`, complete Canonical JSON, `source_hash`, `schema_version`, `created_at` |

Foreign keys protect Strategy/current-Revision, Revision/Strategy, and parent relationships.
Database triggers reject every Revision update or delete. `BEGIN IMMEDIATE` transactions cover both
aggregate creation and compare-parent/insert/advance saves.

Initialization is automatic and idempotent; an unknown `user_version` fails safely. Schema version
2 adds Backtest Runs, schema version 3 adds Decision Events, and schema version 4 admits the additive
Evidence v2 contract without changing Strategy or Revision tables. Moving to PostgreSQL would replace this
repository adapter and transaction SQL while
leaving the service, domain objects, API, and Canonical serialization contract intact.

## Source snapshot and hash

The stored snapshot is the complete Pydantic-validated `CanonicalStrategyV1.model_dump(mode="json")`
encoded as UTF-8 JSON with sorted object keys and compact separators. No editor layout, active view,
Flow positions, Backtest configuration, IR, requirements, LeanPlan, C#, or results are present.

`source_hash` reuses the existing `strategy_hash(CanonicalStrategyV1)` contract. It identifies
normalized compiler semantics: metadata is excluded, set-like Canonical collections are sorted,
registry defaults are resolved, typed values are normalized, and SHA-256 is applied. Revision IDs
are independent UUIDs, so equal semantic hashes do not collapse historical identities. Exact
snapshot bytes—not the semantic hash—implement the duplicate-save policy; a metadata-only source
change can therefore be preserved as a distinct Revision while retaining the same semantic hash.

Every stored snapshot deserializes directly to `CanonicalStrategyV1` and can enter
`compile_strategy_to_lean_plan` without frontend or run state. Derived artifacts remain regenerated,
not persisted.

## API

| Method and route | Contract |
| --- | --- |
| `GET /v1/strategies` | List active Strategies, newest update first |
| `POST /v1/strategies` | Atomically create Strategy plus initial Revision |
| `GET /v1/strategies/{strategy_id}` | Read Strategy and its current Revision, including archived identities |
| `PATCH /v1/strategies/{strategy_id}` | Rename an active Strategy without changing Revisions |
| `DELETE /v1/strategies/{strategy_id}` | Idempotently archive; no rows are deleted |
| `GET /v1/strategies/{strategy_id}/revisions` | List immutable Revision summaries, newest first |
| `POST /v1/strategies/{strategy_id}/revisions` | Save with `expected_parent_revision_id`; 201 created or 200 identical no-op |
| `GET /v1/strategies/{strategy_id}/revisions/{revision_id}` | Read one complete historical snapshot |

Errors use the existing `{ "detail": { "code", "message", ... } }` API shape. Codes are
`invalid_strategy_source` (422), `strategy_not_found`/`revision_not_found` (404),
`stale_revision`/`strategy_archived` (409), and `persistence_failure` (500). Request-envelope errors
remain FastAPI's structured 422 response. Raw SQLite paths, SQL, and messages are logged server-side
and never returned.

## Archive policy

`DELETE` archives instead of hard-deleting. Archived Strategies disappear from the active list but
remain directly readable with all Revisions. Rename and Revision save are rejected. This is the
smallest policy that lets future Backtest Runs safely retain Revision foreign keys.

## Initialization and local use

`RULETRADE_DB_PATH` selects the SQLite file. Without it, local execution uses
`data/ruletrade.sqlite3`. Opening the repository initializes or migrates the schema automatically;
no SQL editing is required. Docker Compose uses the named `ruletrade-state` volume at `/app/state`.

The intended frontend flow is:

```text
Explore -> load backend example -> POST Strategy -> open current Revision
        -> edit client working copy -> POST Revision with expected parent
        -> replace workspace Strategy/Revision identity from the response
```

Examples remain backend-owned templates and are never inserted automatically.

## Architecture review

1. Strategy and Revision have independent UUID identities.
2. Revision immutability is enforced by API shape, service behavior, and database triggers.
3. `CanonicalStrategyV1` remains the sole authoritative strategy source.
4. Editor and Backtest state are excluded from storage.
5. Stored Revisions compile through the official compiler entrypoint.
6. Full snapshot serialization and the normalized semantic hash have explicit separate meanings.
7. A stale working copy cannot overwrite or append after a newer Revision.
8. Strategy plus initial Revision creation is one transaction.
9. Revision insert plus current pointer advancement is one transaction.
10. SQLite details stop at the repository boundary.
11. Archive plus immutable Revision IDs supports future Run references.
12. Candidate acceptance can call the same save operation with its expected parent.
13. Scaling the database replaces the repository/transaction implementation, not domain semantics.
14. No Run or Decision Evidence fields or behavior were added.

There are no known must-fix findings. SQLite's single-writer profile is good enough for the local
Strategy/Revision MVP. Authentication, ownership, migrations beyond schema 1, run persistence,
Decision Evidence, Candidates, and Comparison are intentionally deferred.
