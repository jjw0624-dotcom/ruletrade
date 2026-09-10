from __future__ import annotations

import logging
import os
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ruletrade import __version__
from ruletrade.backtest_runs.errors import (
    BacktestRunDomainError,
    BacktestRunNotFoundError,
    BacktestRunPersistenceError,
    InvalidRunConfigError,
)
from ruletrade.backtest_runs.models import (
    BacktestRunList,
    BacktestRunRecord,
    CreateBacktestRunRequest,
)
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.errors import (
    InvalidStrategyError,
    LeanExecutionError,
    LeanRuntimeUnavailableError,
    MalformedLeanResultError,
    MarketDataUnavailableError,
    UnsupportedStrategyError,
)
from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.backtests.models import LeanBacktestRequest, LeanBacktestResponse
from ruletrade.backtests.service import BacktestService
from ruletrade.candidates.errors import (
    CandidateAdoptionLineageError,
    CandidateArchivedStrategyError,
    CandidateDomainError,
    CandidateExpectedValueMismatchError,
    CandidateNotFoundError,
    CandidatePersistenceError,
    CandidateRunNotSucceededError,
    InvalidCandidateChangeError,
)
from ruletrade.candidates.models import (
    AdoptCandidateRequest,
    CandidateExecution,
    CandidateList,
    CreateCandidateRequest,
)
from ruletrade.candidates.service import CandidateService
from ruletrade.comparisons.errors import (
    ComparisonDomainError,
    ComparisonEvidenceUnsupportedError,
    ComparisonNotFoundError,
    ComparisonPersistenceError,
    IncomparableRunsError,
)
from ruletrade.comparisons.models import ComparisonRecord
from ruletrade.comparisons.service import ComparisonService
from ruletrade.compile_plan import build_bt_plan
from ruletrade.core.portfolio import resolve_portfolio
from ruletrade.datasets import DatasetError, DatasetRegistry
from ruletrade.decision_evidence.errors import DecisionEventNotFoundError
from ruletrade.decision_evidence.models import (
    DecisionEventDetail,
    DecisionEventList,
)
from ruletrade.domain import BacktestRequest, SimpleStrategySpec
from ruletrade.engines.bt_backend import BackendUnavailableError, backend_status, run_backtest
from ruletrade.hashing import strategy_hash
from ruletrade.market_data.models import MarketDataPreflight, MarketDataPreflightRequest
from ruletrade.market_data.service import MarketDataService
from ruletrade.persistence import (
    SQLiteBacktestRunRepository,
    SQLiteCandidateRepository,
    SQLiteComparisonRepository,
    SQLiteStrategyRepository,
)
from ruletrade.strategies.errors import (
    InvalidStrategySourceError,
    PersistenceError,
    RevisionNotFoundError,
    StaleRevisionError,
    StrategyArchivedError,
    StrategyDomainError,
    StrategyNotFoundError,
)
from ruletrade.strategies.models import (
    CreateStrategyRequest,
    RenameStrategyRequest,
    RevisionList,
    RevisionRecord,
    SaveRevisionRequest,
    SaveRevisionResponse,
    StrategyDetail,
    StrategyList,
)
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.models import ResolveStrategyRequest, StrategyDocument
from ruletrade.strategy.v1.fixtures import (
    cooldown_strategy,
    fallback_momentum_strategy,
    filter_screening_strategy,
    golden_portfolio_strategy,
    independent_schedules_strategy,
    momentum_top_n_strategy,
    portfolio_sleeves_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY
from ruletrade.strategy.v1.validation import collect_semantic_issues

logger = logging.getLogger(__name__)


def default_data_dir() -> Path:
    configured = os.getenv("RULETRADE_DATA_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "data"


def default_strategy_db_path() -> Path:
    configured = os.getenv("RULETRADE_DB_PATH")
    if configured:
        return Path(configured)
    return default_data_dir() / "ruletrade.sqlite3"


registry = DatasetRegistry(default_data_dir())
app = FastAPI(title="RuleTrade MVP API", version=__version__)
lean_executor = BacktestService(DockerLeanRunner(), MarketDataService())
strategy_service: StrategyService | None = None
strategy_service_path: Path | None = None
backtest_run_service: BacktestRunService | None = None
backtest_run_service_path: Path | None = None
candidate_service: CandidateService | None = None
candidate_service_path: Path | None = None
comparison_service: ComparisonService | None = None
comparison_service_path: Path | None = None


def get_lean_backtest_service() -> BacktestRunService:
    global backtest_run_service, backtest_run_service_path
    path = default_strategy_db_path()
    if backtest_run_service is None or backtest_run_service_path != path:
        backtest_run_service = BacktestRunService(
            SQLiteBacktestRunRepository(path),
            get_strategy_service(),
            lean_executor,
        )
        backtest_run_service_path = path
    return backtest_run_service


def get_strategy_service() -> StrategyService:
    global strategy_service, strategy_service_path
    path = default_strategy_db_path()
    if strategy_service is None or strategy_service_path != path:
        strategy_service = StrategyService(SQLiteStrategyRepository(path))
        strategy_service_path = path
    return strategy_service


def get_candidate_service() -> CandidateService:
    global candidate_service, candidate_service_path
    path = default_strategy_db_path()
    if candidate_service is None or candidate_service_path != path:
        candidate_service = CandidateService(
            SQLiteCandidateRepository(path),
            get_strategy_service(),
            get_lean_backtest_service(),
        )
        candidate_service_path = path
    return candidate_service


def get_comparison_service() -> ComparisonService:
    global comparison_service, comparison_service_path
    path = default_strategy_db_path()
    if comparison_service is None or comparison_service_path != path:
        comparison_service = ComparisonService(
            SQLiteComparisonRepository(path),
            get_candidate_service(),
            get_lean_backtest_service(),
        )
        comparison_service_path = path
    return comparison_service


@app.exception_handler(StrategyDomainError)
async def strategy_domain_error(
    _request: Request,
    exc: StrategyDomainError,
) -> JSONResponse:
    status_code = 500
    detail: dict[str, object] = {
        "code": exc.code,
        "message": "Strategy persistence is temporarily unavailable.",
    }
    if isinstance(exc, InvalidStrategySourceError):
        status_code = 422
        detail = {
            "code": exc.code,
            "message": str(exc),
            "issues": [
                {"path": issue.path, "message": issue.message}
                for issue in exc.issues
            ],
        }
    elif isinstance(exc, (StrategyNotFoundError, RevisionNotFoundError)):
        status_code = 404
        detail = {"code": exc.code, "message": str(exc)}
    elif isinstance(exc, StrategyArchivedError):
        status_code = 409
        detail = {"code": exc.code, "message": str(exc)}
    elif isinstance(exc, StaleRevisionError):
        status_code = 409
        detail = {
            "code": exc.code,
            "message": str(exc),
            "current_revision_id": exc.current_revision_id,
        }
    elif isinstance(exc, PersistenceError):
        logger.exception("Strategy persistence operation failed", exc_info=exc)
    return JSONResponse(status_code=status_code, content={"detail": detail})


@app.exception_handler(BacktestRunDomainError)
async def backtest_run_domain_error(
    _request: Request,
    exc: BacktestRunDomainError,
) -> JSONResponse:
    if isinstance(exc, InvalidRunConfigError):
        return JSONResponse(
            status_code=422,
            content={
                "detail": {
                    "code": exc.code,
                    "message": str(exc),
                    "issues": [
                        {"path": issue.path, "message": issue.message}
                        for issue in exc.issues
                    ],
                }
            },
        )
    if isinstance(exc, BacktestRunNotFoundError):
        return JSONResponse(
            status_code=404,
            content={"detail": {"code": exc.code, "message": str(exc)}},
        )
    if isinstance(exc, BacktestRunPersistenceError):
        logger.exception("Backtest Run persistence operation failed", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "code": "persistence_failure",
                "message": "Backtest Run persistence is temporarily unavailable.",
            }
        },
    )


@app.exception_handler(DecisionEventNotFoundError)
async def decision_event_not_found(
    _request: Request,
    exc: DecisionEventNotFoundError,
) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"detail": {"code": exc.code, "message": str(exc)}},
    )


@app.exception_handler(CandidateDomainError)
async def candidate_domain_error(
    _request: Request,
    exc: CandidateDomainError,
) -> JSONResponse:
    if isinstance(exc, CandidateNotFoundError):
        status_code = 404
    elif isinstance(exc, (CandidateExpectedValueMismatchError, CandidateArchivedStrategyError, CandidateAdoptionLineageError, CandidateRunNotSucceededError)):
        status_code = 409
    elif isinstance(exc, InvalidCandidateChangeError):
        status_code = 422
    else:
        status_code = 500
    if isinstance(exc, CandidatePersistenceError):
        logger.exception("Candidate persistence operation failed", exc_info=exc)
        message = "Candidate persistence is temporarily unavailable."
    else:
        message = str(exc)
    return JSONResponse(
        status_code=status_code,
        content={"detail": {"code": exc.code, "message": message}},
    )


@app.exception_handler(ComparisonDomainError)
async def comparison_domain_error(
    _request: Request,
    exc: ComparisonDomainError,
) -> JSONResponse:
    if isinstance(exc, ComparisonNotFoundError):
        status_code = 404
    elif isinstance(exc, (IncomparableRunsError, ComparisonEvidenceUnsupportedError)):
        status_code = 409
    else:
        status_code = 500
    if isinstance(exc, ComparisonPersistenceError):
        logger.exception("Comparison persistence operation failed", exc_info=exc)
        message = "Comparison persistence is temporarily unavailable."
    else:
        message = str(exc)
    return JSONResponse(
        status_code=status_code,
        content={"detail": {"code": exc.code, "message": message}},
    )


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
    example: Literal[
        "golden", "momentum", "filter", "fallback", "sleeves", "independent_schedules", "cooldown"
    ] = "golden",
) -> dict[str, object]:
    examples = {
        "golden": golden_portfolio_strategy,
        "momentum": momentum_top_n_strategy,
        "filter": filter_screening_strategy,
        "fallback": fallback_momentum_strategy,
        "sleeves": portfolio_sleeves_strategy,
        "independent_schedules": independent_schedules_strategy,
        "cooldown": cooldown_strategy,
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
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> LeanBacktestResponse:
    try:
        return service.execute_transient(request)
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
    except MarketDataUnavailableError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except LeanExecutionError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc


@app.post(
    "/v1/revisions/{revision_id}/backtest-runs",
    response_model=BacktestRunRecord,
    status_code=201,
)
def create_persisted_backtest_run(
    revision_id: str,
    request: CreateBacktestRunRequest,
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> BacktestRunRecord:
    return service.create_and_execute(revision_id, request.config)


@app.post(
    "/v1/revisions/{revision_id}/market-data/preflight",
    response_model=MarketDataPreflight,
)
def preflight_revision_market_data(
    revision_id: str,
    request: MarketDataPreflightRequest,
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> MarketDataPreflight:
    return service.preflight(revision_id, request.config)


@app.get(
    "/v1/revisions/{revision_id}/backtest-runs",
    response_model=BacktestRunList,
)
def list_persisted_backtest_runs(
    revision_id: str,
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> BacktestRunList:
    return BacktestRunList(items=list(service.list_runs(revision_id)))


@app.get("/v1/backtest-runs/{run_id}", response_model=BacktestRunRecord)
def read_persisted_backtest_run(
    run_id: str,
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> BacktestRunRecord:
    return service.get_run(run_id)


@app.get(
    "/v1/backtest-runs/{run_id}/decision-events",
    response_model=DecisionEventList,
)
def list_run_decision_events(
    run_id: str,
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> DecisionEventList:
    return DecisionEventList(items=list(service.list_decision_events(run_id)))


@app.get(
    "/v1/backtest-runs/{run_id}/decision-events/{event_id}",
    response_model=DecisionEventDetail,
)
def read_run_decision_event(
    run_id: str,
    event_id: str,
    service: Annotated[BacktestRunService, Depends(get_lean_backtest_service)],
) -> DecisionEventDetail:
    return service.get_decision_event(run_id, event_id)


@app.post(
    "/v1/backtest-runs/{run_id}/candidates",
    response_model=CandidateExecution,
    status_code=201,
)
def create_candidate(
    run_id: str,
    request: CreateCandidateRequest,
    service: Annotated[CandidateService, Depends(get_candidate_service)],
) -> CandidateExecution:
    return service.create_and_execute(
        run_id,
        request.change,
        originating_decision_event_id=request.originating_decision_event_id,
    )


@app.get(
    "/v1/backtest-runs/{run_id}/candidates",
    response_model=CandidateList,
)
def list_candidates(
    run_id: str,
    service: Annotated[CandidateService, Depends(get_candidate_service)],
) -> CandidateList:
    return CandidateList(items=service.list_for_run(run_id))


@app.post(
    "/v1/candidates/{candidate_id}/adopt",
    response_model=SaveRevisionResponse,
)
def adopt_candidate(
    candidate_id: str,
    request: AdoptCandidateRequest,
    service: Annotated[CandidateService, Depends(get_candidate_service)],
) -> SaveRevisionResponse:
    return service.adopt(candidate_id, request.expected_current_revision_id)


@app.get("/v1/candidates/{candidate_id}", response_model=CandidateExecution)
def read_candidate(
    candidate_id: str,
    service: Annotated[CandidateService, Depends(get_candidate_service)],
) -> CandidateExecution:
    return service.get(candidate_id)


@app.post(
    "/v1/candidates/{candidate_id}/comparison",
    response_model=ComparisonRecord,
    status_code=201,
)
def create_comparison(
    candidate_id: str,
    service: Annotated[ComparisonService, Depends(get_comparison_service)],
) -> ComparisonRecord:
    return service.create(candidate_id)


@app.get("/v1/comparisons/{comparison_id}", response_model=ComparisonRecord)
def read_comparison(
    comparison_id: str,
    service: Annotated[ComparisonService, Depends(get_comparison_service)],
) -> ComparisonRecord:
    return service.get(comparison_id)


@app.get("/v1/strategies", response_model=StrategyList)
def list_persisted_strategies(
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> StrategyList:
    return StrategyList(items=list(service.list_strategies()))


@app.post("/v1/strategies", response_model=StrategyDetail, status_code=201)
def create_persisted_strategy(
    request: CreateStrategyRequest,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> StrategyDetail:
    return service.create_strategy(request.name, request.canonical_strategy)


@app.get("/v1/strategies/{strategy_id}", response_model=StrategyDetail)
def read_persisted_strategy(
    strategy_id: str,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> StrategyDetail:
    return service.get_strategy(strategy_id)


@app.patch("/v1/strategies/{strategy_id}", response_model=StrategyDetail)
def rename_persisted_strategy(
    strategy_id: str,
    request: RenameStrategyRequest,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> StrategyDetail:
    return service.rename_strategy(strategy_id, request.name)


@app.delete("/v1/strategies/{strategy_id}", status_code=204)
def archive_persisted_strategy(
    strategy_id: str,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> Response:
    service.archive_strategy(strategy_id)
    return Response(status_code=204)


@app.get(
    "/v1/strategies/{strategy_id}/revisions",
    response_model=RevisionList,
)
def list_persisted_revisions(
    strategy_id: str,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> RevisionList:
    return RevisionList(items=list(service.list_revisions(strategy_id)))


@app.post(
    "/v1/strategies/{strategy_id}/revisions",
    response_model=SaveRevisionResponse,
)
def save_persisted_revision(
    strategy_id: str,
    request: SaveRevisionRequest,
    response: Response,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> SaveRevisionResponse:
    result = service.save_revision(
        strategy_id,
        request.expected_parent_revision_id,
        request.canonical_strategy,
    )
    response.status_code = 201 if result.created else 200
    return result


@app.get(
    "/v1/strategies/{strategy_id}/revisions/{revision_id}",
    response_model=RevisionRecord,
)
def read_persisted_revision(
    strategy_id: str,
    revision_id: str,
    service: Annotated[StrategyService, Depends(get_strategy_service)],
) -> RevisionRecord:
    return service.get_revision(strategy_id, revision_id)
