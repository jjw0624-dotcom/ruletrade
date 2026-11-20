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
        """Run the saved Revision once with explicit, reproducible execution settings."""
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Detail BT requires a V2 Strategy Revision.")
        experiment_id = self._id_factory()
        now = self._clock()
        candidate = ExperimentCandidateRecord(
            id=self._id_factory(),
            experiment_id=experiment_id,
            ordinal=1,
            parameters={"role": "detailed"},
            canonical_strategy=revision.canonical_strategy,
            source_hash=revision.source_hash,
            created_at=now,
        )
        config = BacktestConfig.model_validate(request.config)
        experiment = ResearchExperimentRecord(
            id=experiment_id,
            revision_id=revision.id,
            kind=ResearchExperimentKind.DETAIL,
            name=request.name,
            spec={"config": config.model_dump(mode="json"), "mode": "single_revision"},
            candidates=(candidate,),
            created_at=now,
        )
        self.repository.create(experiment)
        run = self.runs.create_and_execute_experiment_candidate(
            base_revision_id=revision.id,
            canonical=candidate.canonical_strategy,
            source_hash=candidate.source_hash,
            schema_version=candidate.canonical_strategy.api_version,
            config=config,
        )
        self.repository.attach_run(candidate.id, run.id)
        return DetailExperimentExecution(
            experiment=self.repository.get(experiment.id),
            runs=(run,),
        )

    def create_hidden(self, revision_id: str, request: CreateHiddenExperimentRequest) -> HiddenExperimentExecution:
        """Select parameters on calibration data and evaluate only the winner on hidden data."""
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidExperimentSpecError("Hidden BT requires a V2 Strategy Revision.")
        policy = hidden_dataset_policy(request.policy_id)
        if policy is None:
            raise InvalidExperimentSpecError(f"Unknown Hidden BT policy: {request.policy_id}")
        base = create_catalog_strategy(request.base)
        if base.source_hash != revision.source_hash:
            raise InvalidExperimentSpecError("Hidden BT base parameters do not reproduce the selected Revision.")
        entries = {item.id: item for item in strategy_catalog()}
        entry = entries.get(request.base.catalog_id)
        allowed = {item.id for item in entry.parameters} if entry else set()
        ids = [item.parameter_id for item in request.dimensions]
        if len(ids) != len(set(ids)):
            raise InvalidExperimentSpecError("Hidden BT parameter dimensions must be unique.")
        forbidden = sorted(set(ids) - allowed)
        if forbidden:
            raise InvalidExperimentSpecError(
                "Parameters are not tunable for this catalog strategy: " + ", ".join(forbidden)
            )
        size = 1
        for dimension in request.dimensions:
            size *= len(dimension.values)
        if size > self.MAX_CANDIDATES:
            raise InvalidExperimentSpecError(
                f"Hidden BT supports at most {self.MAX_CANDIDATES} calibration candidates."
            )

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
                raise InvalidExperimentSpecError(f"Invalid Hidden BT candidate {ordinal}: {exc}") from exc
            candidates.append(ExperimentCandidateRecord(
                id=self._id_factory(),
                experiment_id=experiment_id,
                ordinal=ordinal,
                parameters=parameters,
                canonical_strategy=created.strategy,
                source_hash=created.source_hash,
                created_at=now,
            ))

        experiment = ResearchExperimentRecord(
            id=experiment_id,
            revision_id=revision.id,
            kind=ResearchExperimentKind.HIDDEN,
            name=request.name,
            spec={
                "policy_id": policy.id,
                "base": request.base.model_dump(mode="json"),
                "dimensions": [item.model_dump(mode="json") for item in request.dimensions],
                "selection_metric": "total_return",
                "hidden_execution": "selected_candidate_only",
            },
            candidates=tuple(candidates),
            created_at=now,
        )
        self.repository.create(experiment)
        calibration_config = BacktestConfig(
            start_date=policy.calibration.start_date,
            end_date=policy.calibration.end_date,
            initial_cash=policy.initial_cash,
            dataset_id=policy.dataset_id,
        )
        calibration_runs = []
        for candidate in candidates:
            run = self.runs.create_and_execute_experiment_candidate(
                base_revision_id=revision.id,
                canonical=candidate.canonical_strategy,
                source_hash=candidate.source_hash,
                schema_version=candidate.canonical_strategy.api_version,
                config=calibration_config,
            )
            self.repository.attach_run(candidate.id, run.id)
            calibration_runs.append(run)
        successful = [
            (candidate, run)
            for candidate, run in zip(candidates, calibration_runs, strict=True)
            if run.result is not None
        ]
        if not successful:
            raise InvalidExperimentSpecError("Hidden BT calibration produced no successful candidate.")
        selected, selected_calibration_run = max(
            successful, key=lambda item: (item[1].result.total_return, -item[0].ordinal)
        )
        hidden_config = BacktestConfig(
            start_date=policy.evaluation.start_date,
            end_date=policy.evaluation.end_date,
            initial_cash=policy.initial_cash,
            dataset_id=policy.dataset_id,
        )
        hidden_run = self.runs.create_and_execute_experiment_candidate(
            base_revision_id=revision.id,
            canonical=selected.canonical_strategy,
            source_hash=selected.source_hash,
            schema_version=selected.canonical_strategy.api_version,
            config=hidden_config,
        )
        self.repository.attach_hidden_outcome(
            experiment.id, selected.ordinal, hidden_run.id, self._clock()
        )
        gap = None
        if selected_calibration_run.result is not None and hidden_run.result is not None:
            gap = selected_calibration_run.result.total_return - hidden_run.result.total_return
        return HiddenExperimentExecution(
            experiment=self.repository.get(experiment.id),
            policy=policy,
            calibration_runs=tuple(calibration_runs),
            selected_candidate_ordinal=selected.ordinal,
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

    def get_hidden(self, experiment_id: str) -> HiddenExperimentExecution:
        experiment = self.repository.get(experiment_id)
        if experiment.kind != ResearchExperimentKind.HIDDEN:
            raise InvalidExperimentSpecError("Only a Hidden experiment has a hidden outcome.")
        policy_id = experiment.spec.get("policy_id")
        policy = hidden_dataset_policy(str(policy_id)) if policy_id else None
        if policy is None:
            raise InvalidExperimentSpecError("Hidden Experiment policy is no longer available.")
        calibration_runs = []
        for candidate in experiment.candidates:
            if candidate.run_id is None:
                raise InvalidExperimentSpecError("Hidden Experiment calibration Run is missing.")
            calibration_runs.append(self.runs.get_run(candidate.run_id))
        selected_ordinal, hidden_run_id = self.repository.get_hidden_outcome(experiment.id)
        selected_run = next(
            (
                run for candidate, run in zip(experiment.candidates, calibration_runs, strict=True)
                if candidate.ordinal == selected_ordinal
            ),
            None,
        )
        if selected_run is None:
            raise InvalidExperimentSpecError("Hidden Experiment selected candidate is missing.")
        hidden_run = self.runs.get_run(hidden_run_id)
        gap = None
        if selected_run.result is not None and hidden_run.result is not None:
            gap = selected_run.result.total_return - hidden_run.result.total_return
        return HiddenExperimentExecution(
            experiment=experiment,
            policy=policy,
            calibration_runs=tuple(calibration_runs),
            selected_candidate_ordinal=selected_ordinal,
            hidden_run=hidden_run,
            generalization_gap=gap,
        )

    def get(self, experiment_id: str) -> ResearchExperimentRecord:
        return self.repository.get(experiment_id)

    def list_for_revision(self, revision_id: str) -> tuple[ResearchExperimentRecord, ...]:
        self.strategies.get_revision_by_id(revision_id)
        return self.repository.list_for_revision(revision_id)

    def list_for_strategy(self, strategy_id: str) -> tuple[ResearchExperimentRecord, ...]:
        revisions = self.strategies.list_revisions(strategy_id)
        return self.repository.list_for_revisions(tuple(item.id for item in revisions))
