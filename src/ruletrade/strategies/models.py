from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from ruletrade.strategy.v1.models import CanonicalStrategyV1


StrategyName = Annotated[str, Field(min_length=1, max_length=100)]


class ProductModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StrategyRecord(ProductModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    current_revision_id: str
    archived_at: datetime | None = None


class RevisionRecord(ProductModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    strategy_id: str
    parent_revision_id: str | None
    canonical_strategy: CanonicalStrategyV1
    source_hash: str
    schema_version: str
    created_at: datetime


class RevisionSummary(ProductModel):
    id: str
    strategy_id: str
    parent_revision_id: str | None
    source_hash: str
    schema_version: str
    created_at: datetime


class StrategyDetail(ProductModel):
    strategy: StrategyRecord
    current_revision: RevisionRecord


class StrategyList(ProductModel):
    items: list[StrategyRecord]


class RevisionList(ProductModel):
    items: list[RevisionSummary]


class CreateStrategyRequest(ProductModel):
    name: StrategyName
    canonical_strategy: dict[str, Any]


class RenameStrategyRequest(ProductModel):
    name: StrategyName


class SaveRevisionRequest(ProductModel):
    expected_parent_revision_id: Annotated[str, Field(min_length=1)]
    canonical_strategy: dict[str, Any]


class SaveRevisionResponse(ProductModel):
    created: bool
    strategy: StrategyRecord
    revision: RevisionRecord
