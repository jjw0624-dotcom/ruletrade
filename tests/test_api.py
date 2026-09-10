from copy import deepcopy

from fastapi.testclient import TestClient

from ruletrade.api import app, get_lean_backtest_service
from ruletrade.backtests.errors import LeanExecutionError, LeanRuntimeUnavailableError
from ruletrade.backtests.lean_runner import LeanRunArtifact
from ruletrade.backtests.models import LeanBacktestRequest, LeanBacktestResponse
from ruletrade.backtests.service import BacktestService
from ruletrade.market_data.models import (
    MarketDataPreflight,
    MarketDataRequirement,
    MarketDataSymbolAvailability,
    MarketDataSymbolRequirement,
)
from ruletrade.strategy.v1.fixtures import (
    GOLDEN_PORTFOLIO_PAYLOAD,
    GOLDEN_STATEFUL_RULE_PAYLOAD,
)

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


def test_editor_bootstrap_can_deliver_momentum_source_model() -> None:
    response = client.get("/v1/editor/bootstrap?example=momentum")

    assert response.status_code == 200
    payload = response.json()
    assert payload["strategy"]["metadata"]["name"] == "Trailing Return Top 2"
    assert [
        component["primitive"] for component in payload["strategy"]["graph"]["components"]
    ] == [
        "monthly@1",
        "asset_set@1",
        "trailing_return@1",
        "rank@1",
        "top_n@1",
        "equal_weight@1",
        "rebalance@1",
    ]


def test_editor_bootstrap_can_deliver_filter_source_model_and_registry_contract() -> None:
    response = client.get("/v1/editor/bootstrap?example=filter")

    assert response.status_code == 200
    payload = response.json()
    filter_component = next(
        item
        for item in payload["strategy"]["graph"]["components"]
        if item["primitive"] == "filter@1"
    )
    assert filter_component["config"] == {"operator": "gt", "threshold": "0"}
    filter_primitive = next(
        item for item in payload["registry"]["primitives"] if item["id"] == "filter@1"
    )
    assert filter_primitive["inputs"] == [
        {"name": "scores", "value_type": "asset_scores", "required": True, "multiple": False}
    ]
    assert filter_primitive["outputs"] == [
        {"name": "scores", "value_type": "asset_scores", "required": True, "multiple": False}
    ]
    assert filter_primitive["fields"][1]["value_type"] == "percentage"


def test_editor_bootstrap_can_deliver_explicit_fallback_source_model() -> None:
    response = client.get("/v1/editor/bootstrap?example=fallback")

    assert response.status_code == 200
    payload = response.json()
    component = next(
        item for item in payload["strategy"]["graph"]["components"]
        if item["primitive"] == "fallback@1"
    )
    assert component["config"] == {"fallback_asset_set_ref": "fallback_tlt"}
    definition = next(
        item for item in payload["strategy"]["definitions"]["asset_sets"]
        if item["id"] == "fallback_tlt"
    )
    assert definition["assets"] == ["TLT"]
    primitive = next(
        item for item in payload["registry"]["primitives"] if item["id"] == "fallback@1"
    )
    assert primitive["fields"][0]["reference"] == "asset_set"


def test_editor_bootstrap_can_deliver_portfolio_sleeves_source_model() -> None:
    response = client.get("/v1/editor/bootstrap?example=sleeves")

    assert response.status_code == 200
    payload = response.json()
    assert payload["validation"] == {"valid": True, "issues": []}
    sleeves = [
        item for item in payload["strategy"]["graph"]["components"]
        if item["primitive"] == "portfolio_sleeve@1"
    ]
    assert [(item["id"], item["config"]["allocation"]) for item in sleeves] == [
        ("growth_sleeve", "0.70"),
        ("defensive_sleeve", "0.30"),
    ]


def test_editor_bootstrap_can_deliver_independent_schedule_source_model() -> None:
    response = client.get("/v1/editor/bootstrap?example=independent_schedules")

    assert response.status_code == 200
    payload = response.json()
    assert payload["validation"] == {"valid": True, "issues": []}
    components = {
        item["id"]: item for item in payload["strategy"]["graph"]["components"]
    }
    assert components["growth_monthly"]["primitive"] == "monthly@1"
    assert components["portfolio_quarterly"]["primitive"] == "quarterly@1"
    assert {
        (item["event_component_id"], item["target_component_id"])
        for item in payload["strategy"]["entrypoints"]
    } == {
        ("growth_monthly", "growth_sleeve"),
        ("portfolio_quarterly", "defensive_sleeve"),
        ("portfolio_quarterly", "rebalance"),
    }


def test_editor_bootstrap_can_deliver_high_level_cooldown_source_model() -> None:
    response = client.get("/v1/editor/bootstrap?example=cooldown")

    assert response.status_code == 200
    payload = response.json()
    assert payload["validation"] == {"valid": True, "issues": []}
    components = {
        item["id"]: item for item in payload["strategy"]["graph"]["components"]
    }
    assert components["daily"]["primitive"] == "daily@1"
    assert components["cooldown"] == {
        "id": "cooldown",
        "primitive": "cooldown@1",
        "config": {"duration": 20, "unit": "trading_days"},
        "condition": None,
        "actions": [],
    }
    primitive = next(
        item for item in payload["registry"]["primitives"] if item["id"] == "cooldown@1"
    )
    assert primitive["inputs"][0]["value_type"] == "asset_set"
    assert primitive["fields"][0]["minimum"] == "1"


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


class ApiFakeRunner:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[str] = []

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls.append(generated_csharp)
        if self.error:
            raise self.error
        return LeanRunArtifact(
            log_text="Backtest completed",
            result_payload={
                "statistics": {
                    "Start Equity": "100000",
                    "End Equity": "133448.49",
                    "Net Profit": "33.448%",
                    "Total Orders": "51",
                    "Total Fees": "$73.86",
                },
                "charts": {
                    "Strategy Equity": {
                        "name": "Strategy Equity",
                        "chartType": 0,
                        "series": {
                            "Equity": {
                                "name": "Equity",
                                "unit": "$",
                                "index": 0,
                                "seriesType": 4,
                                "values": [
                                    [1704153600, 100000, 100000, 100000, 100000],
                                    [
                                        1735603200,
                                        133448.49,
                                        133448.49,
                                        133448.49,
                                        133448.49,
                                    ],
                                ]
                            }
                        }
                    }
                },
            },
        )


class ApiTransientBacktestService:
    def __init__(self, runner: ApiFakeRunner) -> None:
        self.executor = BacktestService(runner)

    def execute_transient(self, request: LeanBacktestRequest) -> LeanBacktestResponse:
        return self.executor.execute(request)

    def preflight(self, revision_id: str, config) -> MarketDataPreflight:
        assert revision_id == "revision-1"
        assert config.dataset_id == "us-equity-daily-local"
        requirement = MarketDataRequirement(
            dataset_id=config.dataset_id,
            requested_start=config.start_date,
            requested_end=config.end_date,
            symbols=(
                MarketDataSymbolRequirement(symbol="QQQ", warmup_observations=126),
            ),
        )
        return MarketDataPreflight(
            overall="available",
            dataset_id=config.dataset_id,
            source_kind="local_lean_data",
            provider_id="lean-local-data",
            requirement=requirement,
            symbols=(
                MarketDataSymbolAvailability(
                    symbol="QQQ",
                    status="available",
                    reason="available",
                    warmup_observations_required=126,
                    warmup_observations_available=300,
                ),
            ),
            cache_hit=True,
            elapsed_ms=0,
        )


def post_lean_backtest(payload: dict[str, object], runner: ApiFakeRunner):
    app.dependency_overrides[get_lean_backtest_service] = lambda: ApiTransientBacktestService(runner)
    try:
        return client.post("/v1/backtests/lean", json=payload)
    finally:
        app.dependency_overrides.clear()


def test_market_data_preflight_api_returns_structured_availability() -> None:
    service = ApiTransientBacktestService(ApiFakeRunner())
    app.dependency_overrides[get_lean_backtest_service] = lambda: service
    try:
        response = client.post(
            "/v1/revisions/revision-1/market-data/preflight",
            json={"config": {"dataset_id": "us-equity-daily-local"}},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["overall"] == "available"
    assert body["symbols"][0]["warmup_observations_required"] == 126


def test_lean_backtest_api_executes_submitted_canonical() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][2]["config"]["count"] = 3
    runner = ApiFakeRunner()

    response = post_lean_backtest({"strategy": payload, "config": {}}, runner)

    assert response.status_code == 200
    assert response.json()["result"]["total_orders"] == 51
    assert response.json()["result"]["final_value"] == "133448.49"
    assert "}, 3," in runner.calls[0]


def test_lean_backtest_api_rejects_invalid_strategy_before_execution() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["entrypoints"] = [
        {"event_component_id": "rebalance", "target_component_id": "monthly"}
    ]
    runner = ApiFakeRunner()

    response = post_lean_backtest({"strategy": payload}, runner)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_strategy"
    assert runner.calls == []


def test_lean_backtest_api_distinguishes_unsupported_strategy() -> None:
    runner = ApiFakeRunner()
    response = post_lean_backtest({"strategy": GOLDEN_STATEFUL_RULE_PAYLOAD}, runner)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unsupported_strategy"
    assert runner.calls == []


def test_lean_backtest_api_reports_runtime_unavailable() -> None:
    runner = ApiFakeRunner(LeanRuntimeUnavailableError("Docker runtime is unavailable."))
    response = post_lean_backtest({"strategy": GOLDEN_PORTFOLIO_PAYLOAD}, runner)

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "runtime_unavailable",
        "message": "Docker runtime is unavailable.",
    }


def test_lean_backtest_api_does_not_expose_runner_diagnostics() -> None:
    runner = ApiFakeRunner(
        LeanExecutionError(
            "LEAN process failed (build).",
            diagnostic_output="Main.cs: error CS0246: internal compiler diagnostic",
        )
    )

    response = post_lean_backtest({"strategy": GOLDEN_PORTFOLIO_PAYLOAD}, runner)

    assert response.status_code == 502
    assert response.json()["detail"] == {
        "code": "execution_failed",
        "message": "LEAN process failed (build).",
    }
