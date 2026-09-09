from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_strategy_service
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.hashing import strategy_hash
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.errors import PersistenceError
from ruletrade.strategies.serialization import serialize_source_snapshot
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import (
    GOLDEN_PORTFOLIO_PAYLOAD,
    cooldown_strategy,
    golden_portfolio_strategy,
    independent_schedules_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1


@pytest.fixture
def strategy_api(
    tmp_path: Path,
) -> Iterator[tuple[TestClient, Path]]:
    database = tmp_path / "ruletrade.sqlite3"
    service = StrategyService(SQLiteStrategyRepository(database))
    app.dependency_overrides[get_strategy_service] = lambda: service
    try:
        with TestClient(app) as client:
            yield client, database
    finally:
        app.dependency_overrides.clear()


def _create(client: TestClient, *, name: str = "My Momentum Strategy") -> dict[str, object]:
    response = client.post(
        "/v1/strategies",
        json={"name": name, "canonical_strategy": GOLDEN_PORTFOLIO_PAYLOAD},
    )
    assert response.status_code == 201
    return response.json()


def test_empty_list_create_initial_revision_and_reopen_from_disk(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, database = strategy_api
    assert client.get("/v1/strategies").json() == {"items": []}

    created = _create(client)
    strategy = created["strategy"]
    revision = created["current_revision"]
    assert strategy["current_revision_id"] == revision["id"]
    assert revision["parent_revision_id"] is None
    assert revision["strategy_id"] == strategy["id"]
    assert revision["schema_version"] == "ruletrade.dev/strategy/v1"
    assert revision["id"] != revision["source_hash"]
    expected_source = CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)
    assert revision["canonical_strategy"] == expected_source.model_dump(mode="json")
    assert revision["source_hash"] == strategy_hash(expected_source)
    listed = client.get("/v1/strategies").json()["items"]
    assert [item["id"] for item in listed] == [strategy["id"]]

    reopened = StrategyService(SQLiteStrategyRepository(database)).get_strategy(strategy["id"])
    assert reopened.strategy.id == strategy["id"]
    assert reopened.current_revision.canonical_strategy == expected_source


def test_save_revision_preserves_history_and_identical_source_is_a_no_op(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, _database = strategy_api
    created = _create(client)
    strategy_id = created["strategy"]["id"]
    revision_1 = created["current_revision"]
    edited = deepcopy(revision_1["canonical_strategy"])
    edited["graph"]["components"][2]["config"]["count"] = 3

    saved = client.post(
        f"/v1/strategies/{strategy_id}/revisions",
        json={
            "expected_parent_revision_id": revision_1["id"],
            "canonical_strategy": edited,
        },
    )
    assert saved.status_code == 201
    revision_2 = saved.json()["revision"]
    assert saved.json()["created"] is True
    assert revision_2["id"] != revision_1["id"]
    assert revision_2["parent_revision_id"] == revision_1["id"]
    assert saved.json()["strategy"]["current_revision_id"] == revision_2["id"]

    historical = client.get(
        f"/v1/strategies/{strategy_id}/revisions/{revision_1['id']}"
    )
    assert historical.status_code == 200
    assert historical.json() == revision_1
    assert historical.json()["canonical_strategy"]["graph"]["components"][2]["config"][
        "count"
    ] == 2

    before_no_op = saved.json()["strategy"]["updated_at"]
    no_op = client.post(
        f"/v1/strategies/{strategy_id}/revisions",
        json={
            "expected_parent_revision_id": revision_2["id"],
            "canonical_strategy": edited,
        },
    )
    assert no_op.status_code == 200
    assert no_op.json()["created"] is False
    assert no_op.json()["revision"]["id"] == revision_2["id"]
    assert no_op.json()["strategy"]["updated_at"] == before_no_op
    assert len(client.get(f"/v1/strategies/{strategy_id}/revisions").json()["items"]) == 2


def test_stale_parent_is_a_structured_conflict_without_a_revision(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, _database = strategy_api
    created = _create(client)
    strategy_id = created["strategy"]["id"]
    revision_1 = created["current_revision"]
    edited = deepcopy(revision_1["canonical_strategy"])
    edited["graph"]["components"][2]["config"]["count"] = 3
    revision_2 = client.post(
        f"/v1/strategies/{strategy_id}/revisions",
        json={
            "expected_parent_revision_id": revision_1["id"],
            "canonical_strategy": edited,
        },
    ).json()["revision"]

    stale_edit = deepcopy(edited)
    stale_edit["graph"]["components"][2]["config"]["count"] = 4
    conflict = client.post(
        f"/v1/strategies/{strategy_id}/revisions",
        json={
            "expected_parent_revision_id": revision_1["id"],
            "canonical_strategy": stale_edit,
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {
        "code": "stale_revision",
        "message": "Strategy has advanced since this working copy was opened.",
        "current_revision_id": revision_2["id"],
    }
    assert len(client.get(f"/v1/strategies/{strategy_id}/revisions").json()["items"]) == 2


def test_invalid_source_cannot_leave_a_partial_strategy(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, _database = strategy_api
    invalid = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    invalid["entrypoints"] = [
        {"event_component_id": "rebalance", "target_component_id": "monthly"}
    ]

    response = client.post(
        "/v1/strategies",
        json={"name": "Invalid", "canonical_strategy": invalid},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_strategy_source"
    assert response.json()["detail"]["issues"][0]["path"].startswith("entrypoints")
    assert client.get("/v1/strategies").json() == {"items": []}
    invalid_request = client.post("/v1/strategies", json={})
    assert invalid_request.status_code == 422
    assert isinstance(invalid_request.json()["detail"], list)


def test_create_transaction_rolls_back_if_initial_revision_insert_fails(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"

    def timestamp() -> datetime:
        return datetime(2026, 9, 9, tzinfo=timezone.utc)
    first_ids = iter(("strategy-one", "shared-revision"))
    first = StrategyService(
        SQLiteStrategyRepository(database),
        clock=timestamp,
        id_factory=lambda: next(first_ids),
    )
    first.create_strategy("First", golden_portfolio_strategy())

    second_ids = iter(("strategy-two", "shared-revision"))
    second = StrategyService(
        SQLiteStrategyRepository(database),
        clock=timestamp,
        id_factory=lambda: next(second_ids),
    )
    with pytest.raises(PersistenceError):
        second.create_strategy("Second", golden_portfolio_strategy())

    assert second.repository.get_strategy("strategy-two") is None
    assert [item.id for item in second.list_strategies()] == ["strategy-one"]


def test_rename_does_not_rewrite_revision_and_archive_preserves_history(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, _database = strategy_api
    created = _create(client)
    strategy_id = created["strategy"]["id"]
    revision = created["current_revision"]

    renamed = client.patch(
        f"/v1/strategies/{strategy_id}",
        json={"name": "Renamed Strategy"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["strategy"]["name"] == "Renamed Strategy"
    assert renamed.json()["current_revision"] == revision

    assert client.delete(f"/v1/strategies/{strategy_id}").status_code == 204
    assert client.delete(f"/v1/strategies/{strategy_id}").status_code == 204
    assert client.get("/v1/strategies").json() == {"items": []}
    archived = client.get(f"/v1/strategies/{strategy_id}")
    assert archived.status_code == 200
    assert archived.json()["strategy"]["archived_at"] is not None
    assert (
        client.get(f"/v1/strategies/{strategy_id}/revisions/{revision['id']}").json()
        == revision
    )
    rename = client.patch(
        f"/v1/strategies/{strategy_id}", json={"name": "No"}
    )
    assert rename.status_code == 409
    assert rename.json()["detail"]["code"] == "strategy_archived"
    save = client.post(
        f"/v1/strategies/{strategy_id}/revisions",
        json={
            "expected_parent_revision_id": revision["id"],
            "canonical_strategy": revision["canonical_strategy"],
        },
    )
    assert save.status_code == 409
    assert save.json()["detail"]["code"] == "strategy_archived"


def test_revision_rows_are_immutable_in_the_database(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, database = strategy_api
    revision_id = _create(client)["current_revision"]["id"]
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE strategy_revisions SET source_hash = 'changed' WHERE id = ?",
                (revision_id,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("DELETE FROM strategy_revisions WHERE id = ?", (revision_id,))


@pytest.mark.parametrize(
    "source",
    [golden_portfolio_strategy, cooldown_strategy, independent_schedules_strategy],
)
def test_stored_revision_recompiles_through_the_official_path(
    tmp_path: Path,
    source,
) -> None:
    service = StrategyService(SQLiteStrategyRepository(tmp_path / "ruletrade.sqlite3"))
    canonical = source()
    stored = service.create_strategy(canonical.metadata.name, canonical).current_revision

    assert compile_strategy_to_lean_plan(stored.canonical_strategy) == (
        compile_strategy_to_lean_plan(canonical)
    )


def test_snapshot_serialization_and_semantic_hash_have_separate_contracts() -> None:
    canonical = golden_portfolio_strategy()
    same = CanonicalStrategyV1.model_validate_json(canonical.model_dump_json())
    renamed_metadata = canonical.model_copy(
        update={"metadata": canonical.metadata.model_copy(update={"name": "Display Name"})}
    )

    assert serialize_source_snapshot(canonical) == serialize_source_snapshot(same)
    assert serialize_source_snapshot(canonical) != serialize_source_snapshot(renamed_metadata)
    assert strategy_hash(canonical) == strategy_hash(renamed_metadata)


def test_not_found_and_persistence_errors_are_safe_and_structured(
    strategy_api: tuple[TestClient, Path],
) -> None:
    client, _database = strategy_api
    missing = client.get("/v1/strategies/missing")
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "strategy_not_found"
    created = _create(client)
    missing_revision = client.get(
        f"/v1/strategies/{created['strategy']['id']}/revisions/missing"
    )
    assert missing_revision.status_code == 404
    assert missing_revision.json()["detail"]["code"] == "revision_not_found"

    class BrokenService:
        def list_strategies(self):
            raise PersistenceError("raw sqlite detail")

    app.dependency_overrides[get_strategy_service] = BrokenService
    failed = client.get("/v1/strategies")
    assert failed.status_code == 500
    assert failed.json()["detail"] == {
        "code": "persistence_failure",
        "message": "Strategy persistence is temporarily unavailable.",
    }
    assert "raw sqlite detail" not in failed.text
