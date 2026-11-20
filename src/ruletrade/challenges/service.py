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
        violations = self._preflight_violations(challenge.policy.constraints, catalog_id, parameters)
        if violations:
            raise InvalidChallengeSubmissionError(" ".join(violations))
        run = self.runs.create_and_execute(revision.id, challenge.policy.config)
        if run.result is None:
            violations.append("Official LEAN evaluation did not produce a result.")
        elif (
            challenge.policy.constraints.max_total_orders is not None
            and run.result.total_orders > challenge.policy.constraints.max_total_orders
        ):
            violations.append(
                f"Total orders {run.result.total_orders} exceed the limit "
                f"{challenge.policy.constraints.max_total_orders}."
            )

        eligible = not violations
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
            score=score,
            objective=challenge.policy.objective,
            created_at=self._clock(),
        )
        self.repository.create(submission)
        return ChallengeSubmissionExecution(submission=submission, run=run)

    def get(self, submission_id: str) -> ChallengeSubmissionRecord:
        return self.repository.get(submission_id)

    def list_for_challenge(self, challenge_id: str) -> tuple[ChallengeSubmissionRecord, ...]:
        if get_challenge(challenge_id) is None:
            raise ChallengeNotFoundError("Challenge was not found.")
        submissions = self.repository.list_for_challenge(challenge_id)
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
    def _preflight_violations(constraints: Any, catalog_id: str | None, parameters: dict[str, Any]) -> list[str]:
        violations: list[str] = []
        if catalog_id not in constraints.allowed_catalog_ids:
            violations.append("Strategy catalog family is not allowed by this challenge.")
        for key, required in constraints.required_parameters.items():
            if parameters.get(key) != required:
                violations.append(f"Parameter {key!r} must equal {required!r}.")
        if constraints.allowed_assets:
            submitted_assets: set[str] = set()
            for key, value in parameters.items():
                if "asset" not in key:
                    continue
                values = value if isinstance(value, list) else [value]
                submitted_assets.update(item for item in values if isinstance(item, str))
            forbidden = sorted(submitted_assets - set(constraints.allowed_assets))
            if forbidden:
                violations.append("Assets are not allowed: " + ", ".join(forbidden) + ".")
        return violations
