from __future__ import annotations

from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy, momentum_top_n_strategy
from ruletrade.strategy.v2.migration import MigrationRequest, dry_run_v1_migrations


def test_dry_run_is_deterministic_idempotent_and_non_mutating() -> None:
    first_source = golden_portfolio_strategy()
    second_source = momentum_top_n_strategy()
    before = (first_source.model_dump_json(), second_source.model_dump_json())
    requests = (
        MigrationRequest(
            source=first_source,
            source_revision_id="revision-golden",
            source_semantic_hash="sha256:golden",
            pinned_legacy_policy={"random": "1", "missing": "1"},
        ),
        MigrationRequest(
            source=second_source,
            source_revision_id="revision-momentum",
            source_semantic_hash="sha256:momentum",
            pinned_legacy_policy={"price": "adjusted", "tie": "ordinal"},
        ),
    )
    first = dry_run_v1_migrations(requests)
    second = dry_run_v1_migrations(requests)
    assert first == second
    assert first.mode == "dry_run"
    assert first.report_id.startswith("sha256:")
    assert first.counts == {
        "lossless": 0,
        "requires_user_decision": 0,
        "legacy_read_only": 2,
        "unsupported": 0,
    }
    assert all(item.status == "blocked" and item.candidate is None for item in first.candidates)
    assert before == (first_source.model_dump_json(), second_source.model_dump_json())


def test_dry_run_identity_changes_with_provenance() -> None:
    source = golden_portfolio_strategy()
    base = MigrationRequest(
        source=source,
        source_revision_id="revision-a",
        source_semantic_hash="sha256:a",
        pinned_legacy_policy={"missing": "1"},
    )
    changed = MigrationRequest(
        source=source,
        source_revision_id="revision-b",
        source_semantic_hash="sha256:a",
        pinned_legacy_policy={"missing": "1"},
    )
    assert dry_run_v1_migrations((base,)).report_id != dry_run_v1_migrations((changed,)).report_id
