from __future__ import annotations

from ruletrade.backtests.errors import (
    InvalidStrategyError,
    UnsupportedStrategyError,
    ValidationIssueData,
)
from ruletrade.backtests.lean_runner import LeanRunner
from ruletrade.backtests.models import LeanBacktestRequest, LeanBacktestResponse
from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import (
    CSharpGenerationSettings,
    LeanLoweringError,
    generate_csharp,
)
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.validation import collect_semantic_issues


class BacktestService:
    def __init__(self, runner: LeanRunner) -> None:
        self.runner = runner

    def execute(self, request: LeanBacktestRequest) -> LeanBacktestResponse:
        issues = collect_semantic_issues(request.strategy)
        if issues:
            raise InvalidStrategyError(
                tuple(ValidationIssueData(path=item.path, message=item.message) for item in issues)
            )
        try:
            plan = compile_strategy_to_lean_plan(request.strategy)
        except LeanLoweringError as exc:
            raise UnsupportedStrategyError(str(exc)) from exc
        settings = CSharpGenerationSettings(
            start_date=request.config.start_date,
            end_date=request.config.end_date,
            initial_cash=request.config.initial_cash,
        )
        generated_csharp = generate_csharp(plan, settings)
        artifact = self.runner.run(generated_csharp, dataset_id=request.config.dataset_id)
        return LeanBacktestResponse(
            strategy_hash=strategy_hash(request.strategy),
            config=request.config,
            result=normalize_lean_result(artifact.result_payload),
        )
