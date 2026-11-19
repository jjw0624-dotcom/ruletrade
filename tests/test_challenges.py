from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.challenges.catalog import challenge_catalog


def test_challenge_catalog_has_versioned_learning_and_competition_policies() -> None:
    learning, competition = challenge_catalog()

    assert learning.kind.value == "learning"
    assert learning.policy.constraints.allowed_catalog_ids == ("single_asset_periodic",)
    assert learning.policy.constraints.allowed_assets == ("QQQ", "SPY")
    assert learning.policy.constraints.required_parameters == {"timeframe": "monthly"}
    assert learning.policy.objective.direction == "maximize"

    assert competition.kind.value == "competition"
    assert competition.policy.constraints.allowed_assets == ("SPY",)
    assert competition.policy.constraints.max_total_orders == 12
    assert competition.policy.objective.direction == "minimize"
    assert competition.policy.version == 1


def test_challenge_catalog_api_is_server_owned_and_unknown_ids_are_404() -> None:
    with TestClient(app) as client:
        listed = client.get("/v2/challenges")
        detail = client.get("/v2/challenges/competition-controlled-downside-v1")
        missing = client.get("/v2/challenges/not-real")

    assert listed.status_code == 200
    assert [item["kind"] for item in listed.json()["items"]] == [
        "learning",
        "competition",
    ]
    assert detail.status_code == 200
    assert detail.json()["policy"]["config"]["dataset_id"] == "filter-synthetic"
    assert detail.json()["policy"]["objective"] == {
        "metric": "total_return",
        "direction": "minimize",
    }
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "challenge_not_found"
