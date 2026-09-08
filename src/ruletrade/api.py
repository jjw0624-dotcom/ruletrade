from __future__ import annotations

import os
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException

from ruletrade import __version__
from ruletrade.backtests.errors import (
    InvalidStrategyError,
    LeanExecutionError,
    LeanRuntimeUnavailableError,
    MalformedLeanResultError,
    UnsupportedStrategyError,
)
from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.backtests.models import LeanBacktestRequest, LeanBacktestResponse
from ruletrade.backtests.service import BacktestService
from ruletrade.compile_plan import build_bt_plan
from ruletrade.core.portfolio import resolve_portfolio
from ruletrade.datasets import DatasetError, DatasetRegistry
from ruletrade.domain import BacktestRequest, SimpleStrategySpec
from ruletrade.engines.bt_backend import BackendUnavailableError, backend_status, run_backtest
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.models import ResolveStrategyRequest, StrategyDocument
from ruletrade.strategy.v1.fixtures import (
    fallback_momentum_strategy,
    filter_screening_strategy,
    golden_portfolio_strategy,
    momentum_top_n_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY
from ruletrade.strategy.v1.validation import collect_semantic_issues


def default_data_dir() -> Path:
    configured = os.getenv("RULETRADE_DATA_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "data"


registry = DatasetRegistry(default_data_dir())
app = FastAPI(title="RuleTrade MVP API", version=__version__)
lean_backtest_service = BacktestService(DockerLeanRunner())


def get_lean_backtest_service() -> BacktestService:
    return lean_backtest_service


@app.get("/health")
def health() -> dict[str, object]:
    status = backend_status()
    return {
        "status": "ok",
        "version": __version__,
        "bt": {
            "available": status.available,
            "version": status.version,
            "detail": status.detail,
        },
    }


@app.get("/v1/schema/simple")
def simple_strategy_schema() -> dict[str, object]:
    return SimpleStrategySpec.model_json_schema()


@app.get("/v1/datasets")
def datasets() -> dict[str, object]:
    return {
        "items": [
            {"dataset_id": item.dataset_id, "filename": item.path.name}
            for item in registry.list()
        ]
    }


@app.post("/v1/strategies/validate")
def validate_strategy(spec: SimpleStrategySpec) -> dict[str, object]:
    return {
        "valid": True,
        "strategy_hash": strategy_hash(spec),
        "bt_plan": build_bt_plan(spec).model_dump(mode="json"),
    }


@app.post("/v1/backtests/run")
def execute_backtest(request: BacktestRequest) -> dict[str, object]:
    symbols = [asset.symbol for asset in request.strategy.assets]
    try:
        prices = registry.load_prices(request.dataset_id, symbols)
        result = run_backtest(request.strategy, prices, request.config)
    except DatasetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except BackendUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "strategy_hash": strategy_hash(request.strategy),
        "dataset_id": request.dataset_id,
        "result": result,
    }


@app.post("/v1/core/strategies/validate")
def validate_core_strategy(
    spec: StrategyDocument,
) -> dict[str, object]:
    return {
        "valid": True,
        "strategy_hash": strategy_hash(spec),
        "strategy": spec.model_dump(mode="json"),
    }


@app.post("/v1/core/strategies/resolve")
def resolve_core_strategy(
    request: ResolveStrategyRequest,
) -> dict[str, object]:
    resolution = resolve_portfolio(
        request.strategy,
        event_id=request.event_id,
    )

    return {
        "strategy_hash": strategy_hash(request.strategy),
        "event_id": request.event_id,
        "targets": {
            symbol: str(weight)
            for symbol, weight in resolution.target_weights.items()
        },
        "groups": [
            {
                "group_id": group.group_id,
                "selected_symbols": list(group.selected_symbols),
                "local_weights": {
                    symbol: str(weight)
                    for symbol, weight in group.local_weights.items()
                },
                "portfolio_weights": {
                    symbol: str(weight)
                    for symbol, weight in group.portfolio_weights.items()
                },
            }
            for group in resolution.groups
        ],
    }


@app.get("/v1/canonical/strategies/schema")
def canonical_strategy_v1_schema() -> dict[str, object]:
    return CanonicalStrategyV1.model_json_schema()


def _registry_value(value: object) -> object:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    return value


def _editor_registry_payload() -> dict[str, object]:
    return {
        "primitives": [
            {
                "id": primitive.id,
                "category": primitive.category.value,
                "authoring_views": sorted(primitive.authoring_views),
                "inputs": [
                    {
                        "name": port.name,
                        "value_type": port.value_type.value,
                        "required": port.required,
                        "multiple": port.multiple,
                    }
                    for port in primitive.inputs
                ],
                "outputs": [
                    {
                        "name": port.name,
                        "value_type": port.value_type.value,
                        "required": port.required,
                        "multiple": port.multiple,
                    }
                    for port in primitive.outputs
                ],
                "fields": [
                    {
                        "name": field.name,
                        "value_type": field.value_type.value,
                        "required": field.required,
                        "default": _registry_value(field.default),
                        "minimum": _registry_value(field.minimum),
                        "maximum": _registry_value(field.maximum),
                        "exclusive_minimum": field.exclusive_minimum,
                        "choices": [_registry_value(choice) for choice in field.choices],
                        "reference": _registry_value(field.reference),
                    }
                    for field in primitive.fields
                ],
            }
            for primitive in BUILTIN_REGISTRY.all()
        ]
    }


@app.get("/v1/editor/bootstrap")
def editor_bootstrap(
    example: Literal["golden", "momentum", "filter", "fallback"] = "golden",
) -> dict[str, object]:
    examples = {
        "golden": golden_portfolio_strategy,
        "momentum": momentum_top_n_strategy,
        "filter": filter_screening_strategy,
        "fallback": fallback_momentum_strategy,
    }
    strategy = examples[example]()
    issues = collect_semantic_issues(strategy)
    return {
        "strategy": strategy.model_dump(mode="json"),
        "validation": {
            "valid": not issues,
            "issues": [
                {"path": issue.path, "message": issue.message}
                for issue in issues
            ],
        },
        "registry": _editor_registry_payload(),
    }


@app.post("/v1/canonical/strategies/validate")
def validate_canonical_strategy_v1(
    spec: CanonicalStrategyV1,
) -> dict[str, object]:
    issues = collect_semantic_issues(spec)
    if issues:
        raise HTTPException(
            status_code=422,
            detail=[
                {"path": issue.path, "message": issue.message}
                for issue in issues
            ],
        )

    return {
        "valid": True,
        "strategy_hash": strategy_hash(spec),
        "strategy": spec.model_dump(mode="json"),
    }


@app.post("/v1/backtests/lean", response_model=LeanBacktestResponse)
def execute_lean_backtest(
    request: LeanBacktestRequest,
    service: Annotated[BacktestService, Depends(get_lean_backtest_service)],
) -> LeanBacktestResponse:
    try:
        return service.execute(request)
    except InvalidStrategyError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": exc.code,
                "message": str(exc),
                "issues": [
                    {"path": issue.path, "message": issue.message}
                    for issue in exc.issues
                ],
            },
        ) from exc
    except UnsupportedStrategyError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except LeanRuntimeUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except MalformedLeanResultError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except LeanExecutionError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
