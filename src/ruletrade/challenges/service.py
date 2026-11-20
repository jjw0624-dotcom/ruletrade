from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.challenges.catalog import get_challenge
from ruletrade.challenges.errors import ChallengeNotFoundError, InvalidChallengeSubmissionError
from ruletrade.challenges.models import (
    ChallengeFeedback,
    ChallengeSubmissionExecution,
    ChallengeSubmissionRecord,
)
from ruletrade.persistence.sqlite_challenges import SQLiteChallengeSubmissionRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v2.catalog import (
    CreateCatalogStrategyRequest,
    create_catalog_strategy,
)
from ruletrade.strategy.v2.models import CanonicalStrategyV2


_TAG_PREFIX = "ruletrade.catalog.v1:"
_catalog_request = TypeAdapter(CreateCatalogStrategyRequest)


class ChallengeSubmissionService:
    def __init__(
        self,
        repository: SQLiteChallengeSubmissionRepository,
        strategies: StrategyService,
        runs: BacktestRunService,
        *,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self.strategies = strategies
        self.runs = runs
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid4()))

    def submit(self, challenge_id: str, revision_id: str) -> ChallengeSubmissionExecution:
        challenge = get_challenge(challenge_id)
        if challenge is None:
            raise ChallengeNotFoundError("Challenge was not found.")
        revision = self.strategies.get_revision_by_id(revision_id)
        if not isinstance(revision.canonical_strategy, CanonicalStrategyV2):
            raise InvalidChallengeSubmissionError("Challenge submission requires a V2 Revision.")

        catalog_id, parameters = self._catalog_provenance(
            revision.canonical_strategy, revision.source_hash
        )
        preflight_feedback = self._preflight_feedback(
            challenge.policy.constraints, catalog_id, parameters
        )
        if preflight_feedback:
            raise InvalidChallengeSubmissionError(
                " ".join(item.message for item in preflight_feedback),
                feedback=tuple(preflight_feedback),
            )
        run = self.runs.create_and_execute(revision.id, challenge.policy.config)
        feedback = self._result_feedback(challenge.policy.constraints, run)
        violations = [item.message for item in feedback]

        eligible = not feedback
        score = run.result.total_return if eligible and run.result is not None else None
        submission = ChallengeSubmissionRecord(
            id=self._id_factory(),
            challenge_id=challenge.id,
            challenge_version=challenge.version,
            policy_version=challenge.policy.version,
            revision_id=revision.id,
            run_id=run.id,
            catalog_id=catalog_id,
            catalog_parameters=parameters,
            eligible=eligible,
            violations=tuple(violations),
            feedback=tuple(feedback),
            score=score,
            objective=challenge.policy.objective,
            created_at=self._clock(),
        )
        self.repository.create(submission)
        return ChallengeSubmissionExecution(submission=submission, run=run)

    def get(self, submission_id: str) -> ChallengeSubmissionRecord:
        return self._with_reproduced_feedback(self.repository.get(submission_id))

    def list_for_challenge(self, challenge_id: str) -> tuple[ChallengeSubmissionRecord, ...]:
        if get_challenge(challenge_id) is None:
            raise ChallengeNotFoundError("Challenge was not found.")
        submissions = tuple(
            self._with_reproduced_feedback(item)
            for item in self.repository.list_for_challenge(challenge_id)
        )
        challenge = get_challenge(challenge_id)
        assert challenge is not None
        reverse = challenge.policy.objective.direction == "maximize"
        scored = [item for item in submissions if item.eligible and item.score is not None]
        unscored = [item for item in submissions if item not in scored]
        return tuple(sorted(scored, key=lambda item: item.score, reverse=reverse) + unscored)

    @staticmethod
    def _catalog_provenance(
        strategy: CanonicalStrategyV2,
        source_hash: str,
    ) -> tuple[str | None, dict[str, Any]]:
        """Accept catalog provenance only when the backend factory reproduces the Revision."""
        tag = next((item for item in strategy.metadata.tags if item.startswith(_TAG_PREFIX)), None)
        if tag is None:
            return None, {}
        try:
            payload = json.loads(tag[len(_TAG_PREFIX):])
            request = _catalog_request.validate_python(payload)
            reproduced = create_catalog_strategy(request)
        except (json.JSONDecodeError, TypeError, ValidationError, ValueError):
            return None, {}
        if reproduced.source_hash != source_hash:
            return None, {}
        return request.catalog_id, request.model_dump(mode="json")

    @staticmethod
    def _preflight_feedback(
        constraints: Any,
        catalog_id: str | None,
        parameters: dict[str, Any],
    ) -> list[ChallengeFeedback]:
        feedback: list[ChallengeFeedback] = []
        if catalog_id not in constraints.allowed_catalog_ids:
            feedback.append(ChallengeFeedback(
                code="catalog_family",
                target="catalog",
                message="Strategy catalog family is not allowed by this challenge.",
                expected=list(constraints.allowed_catalog_ids),
                actual=catalog_id,
            ))
        for key, required in constraints.required_parameters.items():
            actual = parameters.get(key)
            if actual != required:
                feedback.append(ChallengeFeedback(
                    code="required_parameter",
                    target="parameter",
                    parameter=key,
                    message=f"Parameter {key!r} must equal {required!r}.",
                    expected=required,
                    actual=actual,
                ))
        if constraints.allowed_assets:
            submitted_assets: set[str] = set()
            asset_parameters: list[str] = []
            for key, value in parameters.items():
                if "asset" not in key:
                    continue
                asset_parameters.append(key)
                values = value if isinstance(value, list) else [value]
                submitted_assets.update(item for item in values if isinstance(item, str))
            forbidden = sorted(submitted_assets - set(constraints.allowed_assets))
            if forbidden:
                feedback.append(ChallengeFeedback(
                    code="allowed_assets",
                    target="parameter",
                    parameter=asset_parameters[0] if len(asset_parameters) == 1 else None,
                    message="Assets are not allowed: " + ", ".join(forbidden) + ".",
                    expected=list(constraints.allowed_assets),
                    actual=forbidden,
                ))
        return feedback

    @staticmethod
    def _result_feedback(constraints: Any, run: Any) -> list[ChallengeFeedback]:
        if run.result is None:
            return [ChallengeFeedback(
                code="evaluation_failed",
                target="result",
                message="Official LEAN evaluation did not produce a result.",
            )]
        limit = constraints.max_total_orders
        if limit is not None and run.result.total_orders > limit:
            return [ChallengeFeedback(
                code="max_total_orders",
                target="execution",
                message=f"Total orders {run.result.total_orders} exceed the limit {limit}.",
                expected=limit,
                actual=run.result.total_orders,
            )]
        return []

    def _with_reproduced_feedback(
        self,
        submission: ChallengeSubmissionRecord,
    ) -> ChallengeSubmissionRecord:
        if submission.feedback:
            return submission
        challenge = get_challenge(submission.challenge_id)
        if challenge is None:
            return submission
        run = self.runs.get_run(submission.run_id)
        feedback = self._result_feedback(challenge.policy.constraints, run)
        return submission.model_copy(update={"feedback": tuple(feedback)})
