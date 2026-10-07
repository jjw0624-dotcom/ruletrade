from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_strategy_service
from ruletrade.hashing import strategy_hash
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.models import AssetSetDefinition, GroupDefinition, StrategyMetadata
from ruletrade.strategy.v2.authoring import (
    ApplyV2AuthoringRequest,
    SetRankingDirection,
    V2AuthoringError,
    apply_v2_authoring,
)
from ruletrade.strategy.v2.daily_values import (
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
)
from ruletrade.strategy.v2.models import (
    BooleanGroupV2,
    CandidateBinding,
    CanonicalStrategyV2,
    ComparisonV2,
    SelectionV2,
    StrategyDefinitionsV2,
)
from ruletrade.strategy.v2.semantic_types import Quantity, Unit, asset_axis
from ruletrade.strategy.v2.validation import SemanticRole, validate_condition, validate_strategy_v2


def candidate_close(semantic_id: str = "candidate-close") -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="observe",
        subject_kind=SubjectKind.CANDIDATE,
        binding_id="candidate",
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )


def candidate_return(period: int = 126, semantic_id: str = "candidate-return") -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="trailing_return",
        observations=period,
        operands=(candidate_close(f"{semantic_id}-close"),),
    )


def return_literal(value: str, semantic_id: str) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="literal",
        value=Decimal(value),
        quantity=Quantity.RETURN,
        unit=Unit.RATIO,
        refinement="trailing_return:adjusted_close",
    )


def strategy_v2() -> CanonicalStrategyV2:
    positive = ComparisonV2(
        semantic_id="positive-return",
        operator="gt",
        left=candidate_return(),
        right=return_literal("0", "zero-return"),
    )
    shorter_positive = ComparisonV2(
        semantic_id="positive-short-return",
        operator="gt",
        left=candidate_return(63, "candidate-return-63"),
        right=return_literal("0", "zero-return-63"),
    )
    return CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name="Generalized v2 selection"),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinition(id="growth_assets", assets=["QQQ", "VGT", "SOXX"]),),
            groups=(GroupDefinition(id="growth", name="Growth", asset_set_ref="growth_assets"),),
            asset_axis=asset_axis("growth"),
        ),
        operator_lock={
            "compare": "1",
            "daily.adjusted_close": "1",
            "daily.trailing_return": "1",
        },
        selection=SelectionV2(
            semantic_id="selection",
            universe_id="growth",
            binding=CandidateBinding(id="candidate", domain_id="growth"),
            eligibility=BooleanGroupV2(
                semantic_id="eligibility-all",
                kind="all",
                children=(
                    positive,
                    BooleanGroupV2(
                        semantic_id="eligibility-any",
                        kind="any",
                        children=(shorter_positive, positive.model_copy(update={"semantic_id": "positive-return-copy"})),
                    ),
                ),
            ),
            ranking=candidate_return(),
            direction="descending",
            count=2,
            shortage_policy="require_full",
            fallback_asset="TLT",
        ),
    )


def test_nested_all_any_daily_values_validate_in_selection_scope() -> None:
    strategy = strategy_v2()
    assert validate_strategy_v2(strategy) == ()
    assert validate_condition(
        strategy.selection.eligibility,
        SemanticRole.ELIGIBILITY,
        bound_candidate_id="candidate",
    ) == ()


def test_candidate_value_is_rejected_in_global_predicate() -> None:
    strategy = strategy_v2()
    comparison = strategy.selection.eligibility.children[0]
    issues = validate_condition(comparison, SemanticRole.PREDICATE, bound_candidate_id=None)
    assert {issue.code for issue in issues} == {"unbound_candidate"}


def test_v2_authoring_is_atomic_and_source_hash_guarded() -> None:
    strategy = strategy_v2()
    request = ApplyV2AuthoringRequest(
        strategy=strategy,
        expected_source_hash=strategy_hash(strategy),
        operation=SetRankingDirection(kind="set_ranking_direction", direction="ascending"),
    )
    changed = apply_v2_authoring(request)
    assert changed.strategy.selection.direction == "ascending"
    assert strategy.selection.direction == "descending"
    with pytest.raises(V2AuthoringError, match="changed"):
        apply_v2_authoring(request.model_copy(update={"expected_source_hash": "stale"}))


def test_v2_strategy_round_trips_through_real_api_and_sqlite(tmp_path: Path) -> None:
    service = StrategyService(SQLiteStrategyRepository(tmp_path / "v2.sqlite3"))
    app.dependency_overrides[get_strategy_service] = lambda: service
    try:
        with TestClient(app) as client:
            source = strategy_v2().model_dump(mode="json")
            created = client.post("/v1/strategies", json={"name": "V2", "canonical_strategy": source})
            assert created.status_code == 201, created.text
            detail = created.json()
            strategy_id = detail["strategy"]["id"]
            first = detail["current_revision"]
            assert first["schema_version"] == "ruletrade.dev/strategy/v2"
            assert first["canonical_strategy"]["selection"]["eligibility"]["kind"] == "all"

            edited = first["canonical_strategy"]
            edited["selection"]["direction"] = "ascending"
            saved = client.post(
                f"/v1/strategies/{strategy_id}/revisions",
                json={
                    "expected_parent_revision_id": first["id"],
                    "canonical_strategy": edited,
                },
            )
            assert saved.status_code == 201, saved.text
            second = saved.json()["revision"]
            assert second["canonical_strategy"]["selection"]["direction"] == "ascending"

            reopened = StrategyService(SQLiteStrategyRepository(tmp_path / "v2.sqlite3")).get_strategy(strategy_id)
            assert isinstance(reopened.current_revision.canonical_strategy, CanonicalStrategyV2)
            assert reopened.current_revision.canonical_strategy.selection.direction == "ascending"
            historical = client.get(f"/v1/strategies/{strategy_id}/revisions/{first['id']}")
            assert historical.json()["canonical_strategy"]["selection"]["direction"] == "descending"
    finally:
        app.dependency_overrides.clear()


def test_v2_api_capabilities_are_provider_honest() -> None:
    with TestClient(app) as client:
        response = client.get("/v2/canonical/authoring/capabilities")
        assert response.status_code == 200
        capabilities = {item["operation_id"]: item for item in response.json()}
        assert capabilities["daily.adjusted_close@1"]["available"] is True
        assert capabilities["daily.rsi_wilder_lean_compat@1"]["available"] is True
        assert capabilities["daily.volume_raw_shares@1"]["available"] is False
        assert capabilities["daily.raw_ohlc@1"]["available"] is False
