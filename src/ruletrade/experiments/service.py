from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from itertools import product
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.models import BacktestConfig
from ruletrade.experiments.errors import InvalidExperimentSpecError
from ruletrade.experiments.models import (
    CreateDetailExperimentRequest, DetailExperimentExecution, ExperimentCandidateRecord,
    ResearchExperimentKind, ResearchExperimentRecord,
)
from ruletrade.persistence.sqlite_experiments import SQLiteResearchExperimentRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v2.catalog import CreateCatalogStrategyRequest, create_catalog_strategy, strategy_catalog
from ruletrade.strategy.v2.models import CanonicalStrategyV2


_catalog_request = TypeAdapter(CreateCatalogStrategyRequest)


class ResearchExperimentService:
    """Plans research variants and delegates every execution to the official LEAN Run pipeline."""

    MAX_CANDIDATES = 32

    def __init__(self, repository: SQLiteResearchExperimentRepository, strategies: StrategyService,
                 runs: BacktestRunService, *, clock: Callable[[], datetime] | None = None,
                 id_factory: Callable[[], str] | None = None) -> None:
        self.repository = repository
        self.strategies = strategies
        self.runs = runs
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid4()))

    def create_detail(self, revision_id: str, request: CreateDetailExperimentRequest) -> DetailExperimentExecution:
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Detail BT requires a V2 Strategy Revision.")
        base = create_catalog_strategy(request.base)
        if base.source_hash != revision.source_hash:
            raise InvalidExperimentSpecError("Detail BT base parameters do not reproduce the selected Revision.")
        entries = {item.id: item for item in strategy_catalog()}
        entry = entries.get(request.base.catalog_id)
        allowed = {item.id for item in entry.parameters} if entry else set()
        ids = [item.parameter_id for item in request.dimensions]
        if len(ids) != len(set(ids)):
            raise InvalidExperimentSpecError("Detail BT parameter dimensions must be unique.")
        forbidden = sorted(set(ids) - allowed)
        if forbidden:
            raise InvalidExperimentSpecError("Parameters are not tunable for this catalog strategy: " + ", ".join(forbidden))
        size = 1
        for dimension in request.dimensions:
            size *= len(dimension.values)
        if size > self.MAX_CANDIDATES:
            raise InvalidExperimentSpecError(f"Detail BT supports at most {self.MAX_CANDIDATES} candidates.")
        experiment_id = self._id_factory()
        now = self._clock()
        candidates: list[ExperimentCandidateRecord] = []
        for ordinal, values in enumerate(product(*(item.values for item in request.dimensions)), start=1):
            parameters = dict(zip(ids, values, strict=True))
            payload = request.base.model_dump(mode="json")
            payload.update(parameters)
            try:
                variant_request = _catalog_request.validate_python(payload)
                created = create_catalog_strategy(variant_request)
            except (ValidationError, ValueError) as exc:
                raise InvalidExperimentSpecError(f"Invalid Detail BT candidate {ordinal}: {exc}") from exc
            candidates.append(ExperimentCandidateRecord(
                id=self._id_factory(), experiment_id=experiment_id, ordinal=ordinal,
                parameters=parameters, canonical_strategy=created.strategy,
                source_hash=created.source_hash, created_at=now,
            ))
        experiment = ResearchExperimentRecord(
            id=experiment_id, revision_id=revision.id, kind=ResearchExperimentKind.DETAIL,
            name=request.name, spec=request.model_dump(mode="json"), candidates=tuple(candidates), created_at=now,
        )
        self.repository.create(experiment)
        config = BacktestConfig.model_validate(request.config)
        executions = []
        for candidate in candidates:
            run = self.runs.create_and_execute_experiment_candidate(
                base_revision_id=revision.id, canonical=candidate.canonical_strategy,
                source_hash=candidate.source_hash, schema_version=candidate.canonical_strategy.api_version,
                config=config,
            )
            self.repository.attach_run(candidate.id, run.id)
            executions.append(run)
        return DetailExperimentExecution(experiment=self.repository.get(experiment.id), runs=tuple(executions))

    def get(self, experiment_id: str) -> ResearchExperimentRecord:
        return self.repository.get(experiment_id)

    def list_for_revision(self, revision_id: str) -> tuple[ResearchExperimentRecord, ...]:
        self.strategies.get_revision_by_id(revision_id)
        return self.repository.list_for_revision(revision_id)
