from __future__ import annotations

from ruletrade.backtests.models import BacktestConfig
from ruletrade.challenges.models import (
    ChallengeConstraints,
    ChallengeDefinition,
    ChallengeEvaluationPolicy,
    ChallengeKind,
    ChallengeObjective,
)


_CHALLENGES = (
    ChallengeDefinition(
        id="learn-monthly-single-asset-v1",
        version=1,
        kind=ChallengeKind.LEARNING,
        title="Monthly allocation fundamentals",
        description=(
            "Create a single-asset strategy that uses monthly timing, then inspect "
            "how a fixed rule becomes a reproducible LEAN evaluation."
        ),
        difficulty="beginner",
        policy=ChallengeEvaluationPolicy(
            version=1,
            config=BacktestConfig(
                start_date="2024-01-02",
                end_date="2024-12-31",
                initial_cash="100000",
                dataset_id="filter-synthetic",
            ),
            objective=ChallengeObjective(direction="maximize"),
            constraints=ChallengeConstraints(
                allowed_catalog_ids=("single_asset_periodic",),
                allowed_assets=("QQQ", "SPY"),
                required_parameters={"timeframe": "monthly"},
                max_total_orders=24,
            ),
        ),
    ),
    ChallengeDefinition(
        id="competition-controlled-downside-v1",
        version=1,
        kind=ChallengeKind.COMPETITION,
        title="Controlled downside",
        description=(
            "Minimize total return while using the fixed SPY monthly rule and staying "
            "within the server-owned order limit."
        ),
        difficulty="intermediate",
        policy=ChallengeEvaluationPolicy(
            version=1,
            config=BacktestConfig(
                start_date="2024-01-02",
                end_date="2024-12-31",
                initial_cash="100000",
                dataset_id="filter-synthetic",
            ),
            objective=ChallengeObjective(direction="minimize"),
            constraints=ChallengeConstraints(
                allowed_catalog_ids=("single_asset_periodic",),
                allowed_assets=("SPY",),
                required_parameters={"timeframe": "monthly"},
                max_total_orders=12,
            ),
        ),
    ),
)


def challenge_catalog() -> tuple[ChallengeDefinition, ...]:
    return _CHALLENGES


def get_challenge(challenge_id: str) -> ChallengeDefinition | None:
    return next((item for item in _CHALLENGES if item.id == challenge_id), None)
