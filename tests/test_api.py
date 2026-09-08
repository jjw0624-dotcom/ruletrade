from fastapi.testclient import TestClient

from ruletrade.api import app
from ruletrade.strategy.v1.fixtures import GOLDEN_PORTFOLIO_PAYLOAD


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_validate_strategy() -> None:
    response = client.post(
        "/v1/strategies/validate",
        json={
            "name": "demo",
            "initial_capital": "10000",
            "recurring_contribution": {"amount": "500"},
            "assets": [
                {"symbol": "QQQ", "weight": "0.4"},
                {"symbol": "VOO", "weight": "0.6"},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["strategy_hash"].startswith("sha256:")


def core_strategy_payload() -> dict[str, object]:
    return {
        "api_version": "ruletrade.dev/strategy/v0",
        "name": "random-growth-defensive",
        "random_seed": 123,
        "groups": [
            {
                "id": "growth",
                "weight": "0.70",
                "universe": ["QQQ", "VGT", "SOXX", "SCHG"],
                "selection": {
                    "type": "random_n",
                    "count": 2,
                    "resample": "per_event",
                },
                "allocation": {
                    "type": "equal_weight",
                },
            },
            {
                "id": "safe",
                "weight": "0.30",
                "universe": ["TLT", "IEF"],
                "selection": {
                    "type": "all",
                },
                "allocation": {
                    "type": "equal_weight",
                },
            },
        ],
        "rebalance": {
            "type": "monthly",
        },
    }


def test_validate_core_strategy() -> None:
    response = client.post(
        "/v1/core/strategies/validate",
        json=core_strategy_payload(),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["valid"] is True
    assert body["strategy_hash"].startswith("sha256:")
    assert body["strategy"]["groups"][0]["id"] == "growth"


def test_resolve_core_strategy() -> None:
    response = client.post(
        "/v1/core/strategies/resolve",
        json={
            "strategy": core_strategy_payload(),
            "event_id": "2026-09",
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["event_id"] == "2026-09"

    assert sum(
        float(weight)
        for weight in body["targets"].values()
    ) == 1.0

    assert body["targets"]["TLT"] == "0.150"
    assert body["targets"]["IEF"] == "0.150"

    growth = next(
        group
        for group in body["groups"]
        if group["group_id"] == "growth"
    )

    assert len(growth["selected_symbols"]) == 2


def test_resolve_core_strategy_is_deterministic() -> None:
    request = {
        "strategy": core_strategy_payload(),
        "event_id": "2026-09",
    }

    first = client.post(
        "/v1/core/strategies/resolve",
        json=request,
    )

    second = client.post(
        "/v1/core/strategies/resolve",
        json=request,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


def test_rejects_invalid_core_strategy() -> None:
    payload = core_strategy_payload()
    payload["groups"][0]["weight"] = "0.80"

    response = client.post(
        "/v1/core/strategies/validate",
        json=payload,
    )

    assert response.status_code == 422


def test_validate_canonical_v1_strategy() -> None:
    response = client.post(
        "/v1/canonical/strategies/validate",
        json=GOLDEN_PORTFOLIO_PAYLOAD,
    )

    assert response.status_code == 200
    assert response.json()["valid"] is True
    assert response.json()["strategy_hash"].startswith("sha256:")


def test_editor_bootstrap_uses_canonical_golden_and_registry() -> None:
    response = client.get("/v1/editor/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["strategy"]["api_version"] == "ruletrade.dev/strategy/v1"
    assert payload["strategy"]["metadata"] == {
        **GOLDEN_PORTFOLIO_PAYLOAD["metadata"],
        "tags": [],
    }
    assert payload["strategy"]["graph"]["components"][2]["config"]["count"] == 2
    assert payload["validation"] == {"valid": True, "issues": []}
    random_select = next(
        item for item in payload["registry"]["primitives"]
        if item["id"] == "random_select@1"
    )
    assert random_select["authoring_views"] == ["blocks", "code", "flow", "guided", "rules"]
    assert random_select["fields"][0]["minimum"] == "1"


def test_rejects_semantically_invalid_canonical_v1_strategy() -> None:
    payload = {
        **GOLDEN_PORTFOLIO_PAYLOAD,
        "entrypoints": [
            {"event_component_id": "rebalance", "target_component_id": "monthly"}
        ],
    }

    response = client.post(
        "/v1/canonical/strategies/validate",
        json=payload,
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["path"].startswith("entrypoints")
