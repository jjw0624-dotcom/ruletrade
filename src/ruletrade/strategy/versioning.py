"""Canonical version dispatch at the persistence/compatibility boundary."""
from __future__ import annotations

from typing import TypeAlias

from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v2.models import CanonicalStrategyV2


CanonicalStrategy: TypeAlias = CanonicalStrategyV1 | CanonicalStrategyV2


def parse_canonical_strategy(value: object) -> CanonicalStrategy:
    """Parse by explicit version without making either model depend on the other."""

    if isinstance(value, (CanonicalStrategyV1, CanonicalStrategyV2)):
        return value
    if not isinstance(value, dict):
        raise ValueError("canonical Strategy must be an object")
    version = value.get("api_version")
    # Pre-version-field snapshots are a documented historical V1 contract.
    if version in {None, "ruletrade.dev/strategy/v1"}:
        return CanonicalStrategyV1.model_validate(value)
    if version == "ruletrade.dev/strategy/v2":
        return CanonicalStrategyV2.model_validate(value)
    raise ValueError(f"unsupported canonical api_version: {version!r}")
