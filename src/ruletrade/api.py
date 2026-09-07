from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException

from ruletrade import __version__
from ruletrade.compile_plan import build_bt_plan
from ruletrade.datasets import DatasetError, DatasetRegistry
from ruletrade.domain import BacktestRequest, SimpleStrategySpec
from ruletrade.engines.bt_backend import BackendUnavailableError, backend_status, run_backtest
from ruletrade.hashing import strategy_hash


def default_data_dir() -> Path:
    configured = os.getenv("RULETRADE_DATA_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "data"


registry = DatasetRegistry(default_data_dir())
app = FastAPI(title="RuleTrade MVP API", version=__version__)


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
