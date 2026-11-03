# Perspective draft reconciliation

Each editable perspective owns its unfinished draft. The shared working semantic state is distinct from both drafts and persisted immutable revisions.

`Perspective draft → completed intent → validation → shared working state → projection → explicit Save/CAS → immutable revision`

Layout-only changes remain local. Compatible changes at independent semantic addresses may reconcile after dependency checks. Stale, direct, and dependency conflicts preserve all drafts and require explicit resolution. Perspective switching never saves a revision, and Test always performs strict preflight against an identified working state or revision.
