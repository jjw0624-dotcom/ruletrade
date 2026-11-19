from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from itertools import product
from random import Random
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.models import BacktestConfig
from ruletrade.experiments.errors import InvalidExperimentSpecError
from ruletrade.experiments.hidden_policies import hidden_dataset_policies, hidden_dataset_policy
from ruletrade.experiments.test_policies import robustness_policies, robustness_policy
from ruletrade.experiments.models import (
    CreateDetailExperimentRequest,
    CreateHiddenExperimentRequest,
    CreateForwardExperimentRequest,
    CreateRandomBaselineExperimentRequest,
    CreateRobustnessExperimentRequest,
    DetailExperimentExecution,
    ExperimentCandidateRecord,
    ForwardExperimentExecution,
    HiddenExperimentExecution,
    ResearchExperimentKind,
    TestExperimentExecution,
    ResearchExperimentRecord,
)
from ruletrade.persistence.sqlite_experiments import SQLiteResearchExperimentRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v2.catalog import (
    CreateCatalogStrategyRequest, SingleAssetCatalogRequest, create_catalog_strategy, strategy_catalog,
)
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

    def create_hidden(self, revision_id: str, request: CreateHiddenExperimentRequest) -> HiddenExperimentExecution:
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Hidden BT requires a V2 Strategy Revision.")
        policy = hidden_dataset_policy(request.policy_id)
        if policy is None:
            raise InvalidExperimentSpecError(f"Unknown Hidden BT policy: {request.policy_id}")
        experiment_id = self._id_factory()
        now = self._clock()
        candidates = tuple(
            ExperimentCandidateRecord(
                id=self._id_factory(),
                experiment_id=experiment_id,
                ordinal=ordinal,
                parameters={"partition": partition},
                canonical_strategy=revision.canonical_strategy,
                source_hash=revision.source_hash,
                created_at=now,
            )
            for ordinal, partition in enumerate(("calibration", "hidden"), start=1)
        )
        experiment = ResearchExperimentRecord(
            id=experiment_id,
            revision_id=revision.id,
            kind=ResearchExperimentKind.HIDDEN,
            name=request.name,
            spec={"policy_id": policy.id},
            candidates=candidates,
            created_at=now,
        )
        self.repository.create(experiment)
        runs = []
        for candidate, window in zip(candidates, (policy.calibration, policy.evaluation), strict=True):
            config = BacktestConfig(
                start_date=window.start_date,
                end_date=window.end_date,
                initial_cash=policy.initial_cash,
                dataset_id=policy.dataset_id,
            )
            run = self.runs.create_and_execute_experiment_candidate(
                base_revision_id=revision.id,
                canonical=candidate.canonical_strategy,
                source_hash=candidate.source_hash,
                schema_version=candidate.canonical_strategy.api_version,
                config=config,
            )
            self.repository.attach_run(candidate.id, run.id)
            runs.append(run)
        calibration_run, hidden_run = runs
        gap = None
        if calibration_run.result is not None and hidden_run.result is not None:
            gap = calibration_run.result.total_return - hidden_run.result.total_return
        return HiddenExperimentExecution(
            experiment=self.repository.get(experiment.id),
            policy=policy,
            calibration_run=calibration_run,
            hidden_run=hidden_run,
            generalization_gap=gap,
        )

    def create_robustness(
        self, revision_id: str, request: CreateRobustnessExperimentRequest
    ) -> TestExperimentExecution:
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Robustness Test requires a V2 Strategy Revision.")
        policy = robustness_policy(request.policy_id)
        if policy is None:
            raise InvalidExperimentSpecError(f"Unknown robustness policy: {request.policy_id}")
        base_config = BacktestConfig.model_validate(request.config)
        if base_config.start_date + timedelta(days=max(policy.start_date_offsets)) > base_config.end_date:
            raise InvalidExperimentSpecError("Robustness start-date offset exceeds the test period.")
        experiment_id = self._id_factory()
        now = self._clock()
        candidates = tuple(
            ExperimentCandidateRecord(
                id=self._id_factory(),
                experiment_id=experiment_id,
                ordinal=ordinal,
                parameters={"start_date_offset_days": offset},
                canonical_strategy=revision.canonical_strategy,
                source_hash=revision.source_hash,
                created_at=now,
            )
            for ordinal, offset in enumerate(policy.start_date_offsets, start=1)
        )
        experiment = ResearchExperimentRecord(
            id=experiment_id,
            revision_id=revision.id,
            kind=ResearchExperimentKind.ROBUSTNESS,
            name=request.name,
            spec={"policy_id": policy.id, "config": base_config.model_dump(mode="json")},
            candidates=candidates,
            created_at=now,
        )
        self.repository.create(experiment)
        executions = []
        for candidate, offset in zip(candidates, policy.start_date_offsets, strict=True):
            shifted_start = base_config.start_date + timedelta(days=offset)
            if shifted_start > base_config.end_date:
                raise InvalidExperimentSpecError("Robustness start-date offset exceeds the test period.")
            config = base_config.model_copy(update={"start_date": shifted_start})
            run = self.runs.create_and_execute_experiment_candidate(
                base_revision_id=revision.id,
                canonical=candidate.canonical_strategy,
                source_hash=candidate.source_hash,
                schema_version=candidate.canonical_strategy.api_version,
                config=config,
            )
            self.repository.attach_run(candidate.id, run.id)
            executions.append(run)
        return TestExperimentExecution(
            experiment=self.repository.get(experiment.id), runs=tuple(executions)
        )

    def create_random_baseline(
        self, revision_id: str, request: CreateRandomBaselineExperimentRequest
    ) -> TestExperimentExecution:
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Random Baseline requires a V2 Strategy Revision.")
        base = create_catalog_strategy(request.base)
        if base.source_hash != revision.source_hash:
            raise InvalidExperimentSpecError(
                "Random Baseline base parameters do not reproduce the selected Revision."
            )
        if len(request.seeds) != len(set(request.seeds)):
            raise InvalidExperimentSpecError("Random Baseline seeds must be unique.")
        payload = request.base.model_dump(mode="json")
        symbols: list[str] = []
        for key in ("assets", "growth_assets"):
            symbols.extend(payload.get(key, []))
        for key in ("asset", "trend_asset", "fallback_asset", "defensive_asset"):
            value = payload.get(key)
            if value:
                symbols.append(value)
        universe = tuple(dict.fromkeys(symbols))
        if not universe:
            raise InvalidExperimentSpecError("Random Baseline requires a non-empty catalog universe.")
        experiment_id = self._id_factory()
        now = self._clock()
        candidates = [ExperimentCandidateRecord(
            id=self._id_factory(),
            experiment_id=experiment_id,
            ordinal=1,
            parameters={"baseline_type": "strategy_reference"},
            canonical_strategy=revision.canonical_strategy,
            source_hash=revision.source_hash,
            created_at=now,
        )]
        for ordinal, seed in enumerate(request.seeds, start=2):
            selected = Random(seed).choice(universe)
            baseline = create_catalog_strategy(SingleAssetCatalogRequest(
                catalog_id="single_asset_periodic",
                name=f"{request.name} seed {seed}",
                asset=selected,
                timeframe=payload.get("timeframe", "monthly"),
            ))
            candidates.append(ExperimentCandidateRecord(
                id=self._id_factory(),
                experiment_id=experiment_id,
                ordinal=ordinal,
                parameters={"baseline_type": "seeded_random_asset", "seed": seed, "selected_asset": selected},
                canonical_strategy=baseline.strategy,
                source_hash=baseline.source_hash,
                created_at=now,
            ))
        experiment = ResearchExperimentRecord(
            id=experiment_id,
            revision_id=revision.id,
            kind=ResearchExperimentKind.RANDOM_BASELINE,
            name=request.name,
            spec={
                "seeds": list(request.seeds),
                "universe": list(universe),
                "config": BacktestConfig.model_validate(request.config).model_dump(mode="json"),
            },
            candidates=tuple(candidates),
            created_at=now,
        )
        self.repository.create(experiment)
        config = BacktestConfig.model_validate(request.config)
        executions = []
        for candidate in candidates:
            run = self.runs.create_and_execute_experiment_candidate(
                base_revision_id=revision.id,
                canonical=candidate.canonical_strategy,
                source_hash=candidate.source_hash,
                schema_version=candidate.canonical_strategy.api_version,
                config=config,
            )
            self.repository.attach_run(candidate.id, run.id)
            executions.append(run)
        return TestExperimentExecution(
            experiment=self.repository.get(experiment.id), runs=tuple(executions)
        )

    def create_forward(
        self, revision_id: str, request: CreateForwardExperimentRequest
    ) -> ForwardExperimentExecution:
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Forward requires a V2 Strategy Revision.")
        as_of = self._clock().date()
        if request.start_date > as_of:
            raise InvalidExperimentSpecError("Forward start date cannot be in the future.")
        experiment_id = self._id_factory()
        now = self._clock()
        candidate = ExperimentCandidateRecord(
            id=self._id_factory(),
            experiment_id=experiment_id,
            ordinal=1,
            parameters={"as_of": as_of.isoformat()},
            canonical_strategy=revision.canonical_strategy,
            source_hash=revision.source_hash,
            created_at=now,
        )
        experiment = ResearchExperimentRecord(
            id=experiment_id,
            revision_id=revision.id,
            kind=ResearchExperimentKind.FORWARD,
            name=request.name,
            spec=request.model_dump(mode="json"),
            candidates=(candidate,),
            created_at=now,
        )
        self.repository.create(experiment)
        run = self._execute_forward_candidate(experiment, candidate, as_of)
        return ForwardExperimentExecution(
            experiment=self.repository.get(experiment.id), latest_run=run
        )

    def refresh_forward(self, experiment_id: str) -> ForwardExperimentExecution:
        experiment = self.repository.get(experiment_id)
        if experiment.kind != ResearchExperimentKind.FORWARD:
            raise InvalidExperimentSpecError("Only a Forward experiment can be refreshed.")
        as_of = self._clock().date()
        latest = experiment.candidates[-1]
        if latest.parameters.get("as_of") == as_of.isoformat():
            if latest.run_id is None:
                raise InvalidExperimentSpecError("Latest Forward snapshot has no attached Run.")
            return ForwardExperimentExecution(
                experiment=experiment, latest_run=self.runs.get_run(latest.run_id)
            )
        start_date = experiment.spec.get("start_date")
        if start_date is None or str(start_date) > as_of.isoformat():
            raise InvalidExperimentSpecError("Forward start date cannot be in the future.")
        revision = self.strategies.get_revision_by_id(experiment.revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Forward requires a V2 Strategy Revision.")
        candidate = ExperimentCandidateRecord(
            id=self._id_factory(),
            experiment_id=experiment.id,
            ordinal=len(experiment.candidates) + 1,
            parameters={"as_of": as_of.isoformat()},
            canonical_strategy=experiment.candidates[0].canonical_strategy,
            source_hash=experiment.candidates[0].source_hash,
            created_at=self._clock(),
        )
        self.repository.add_candidate(candidate)
        run = self._execute_forward_candidate(experiment, candidate, as_of)
        return ForwardExperimentExecution(
            experiment=self.repository.get(experiment.id), latest_run=run
        )

    def _execute_forward_candidate(
        self,
        experiment: ResearchExperimentRecord,
        candidate: ExperimentCandidateRecord,
        as_of,
    ):
        config = BacktestConfig.model_validate({
            "start_date": experiment.spec["start_date"],
            "end_date": as_of,
            "initial_cash": experiment.spec["initial_cash"],
            "dataset_id": experiment.spec["dataset_id"],
        })
        run = self.runs.create_and_execute_experiment_candidate(
            base_revision_id=experiment.revision_id,
            canonical=candidate.canonical_strategy,
            source_hash=candidate.source_hash,
            schema_version=candidate.canonical_strategy.api_version,
            config=config,
        )
        self.repository.attach_run(candidate.id, run.id)
        return run

    def robustness_policies(self):
        return robustness_policies()

    def hidden_policies(self):
        return hidden_dataset_policies()

    def get(self, experiment_id: str) -> ResearchExperimentRecord:
        return self.repository.get(experiment_id)

    def list_for_revision(self, revision_id: str) -> tuple[ResearchExperimentRecord, ...]:
        self.strategies.get_revision_by_id(revision_id)
        return self.repository.list_for_revision(revision_id)
