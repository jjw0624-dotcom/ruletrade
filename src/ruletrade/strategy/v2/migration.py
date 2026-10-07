"""Explicit, non-mutating v1 -> v2 migration candidates."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v2.models import CanonicalStrategyV2


@dataclass(frozen=True)
class MigrationCandidate:
    source_revision_id: str
    source_semantic_hash: str
    pinned_legacy_policy: dict[str, str]
    status: Literal["blocked", "candidate"]
    candidate: CanonicalStrategyV2 | None
    semantic_diff: tuple[str, ...]
    diagnostics: tuple[str, ...]


def upgrade_v1_to_v2(
    source: CanonicalStrategyV1,
    *,
    source_revision_id: str,
    source_semantic_hash: str,
    pinned_legacy_policy: dict[str, str],
) -> MigrationCandidate:
    """Return an honest migration record without mutating the v1 document.

    Automatic conversion is deliberately blocked until the exact v1 contract
    has a demonstrated v2 equivalent and runtime differential proof.  Keeping
    this boundary explicit prevents optional v1 fields from silently acquiring
    v2 Unknown/axis/clock semantics.
    """

    return MigrationCandidate(
        source_revision_id=source_revision_id,
        source_semantic_hash=source_semantic_hash,
        pinned_legacy_policy=dict(sorted(pinned_legacy_policy.items())),
        status="blocked",
        candidate=None,
        semantic_diff=(),
        diagnostics=(
            "automatic_migration_blocked: v1 adjusted-price, missing-value, tie, and no-ELSE policies "
            "must be proven equivalent before a v2 candidate can be created",
        ),
    )
