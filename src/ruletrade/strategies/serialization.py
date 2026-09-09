from __future__ import annotations

import json

from ruletrade.strategy.v1.models import CanonicalStrategyV1


def serialize_source_snapshot(strategy: CanonicalStrategyV1) -> str:
    """Serialize the complete validated Canonical source, excluding no source fields."""

    return json.dumps(
        strategy.model_dump(mode="json"),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
