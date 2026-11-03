"""Version-neutral strategy value objects with stable serialized contracts."""
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


Identifier = Annotated[
    str,
    Field(min_length=1, max_length=100, pattern=r"^[A-Za-z][A-Za-z0-9_-]*$"),
]
Symbol = Annotated[
    str,
    Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:-]+$"),
]


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class StrategyMetadata(FrozenModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    description: Annotated[str, Field(max_length=2000)] = ""
    tags: tuple[str, ...] = ()


class GroupDefinition(FrozenModel):
    """A stable named collection, independent of strategy schema version."""

    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=100)]
    asset_set_ref: Identifier
    description: Annotated[str, Field(max_length=1000)] = ""
