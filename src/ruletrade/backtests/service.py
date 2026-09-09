from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter_ns

from ruletrade.backtests.errors import (
    InvalidStrategyError,
    UnsupportedStrategyError,
    ValidationIssueData,
)
from ruletrade.backtests.lean_runner import LeanRunner
from ruletrade.backtests.models import BacktestTimings, LeanBacktestRequest, LeanBacktestResponse
from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import (
    CSharpGenerationSettings,
    LeanLoweringError,
    generate_csharp,
)
from ruletrade.decision_evidence.collector import collect_decision_evidence
from ruletrade.decision_evidence.models import CollectedDecisionEvent
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.validation import collect_semantic_issues


@dataclass(frozen=True)
class BacktestExecution:
    response: LeanBacktestResponse
    decision_events: tuple[CollectedDecisionEvent, ...]


class BacktestService:
    def __init__(self, runner: LeanRunner) -> None:
        self.runner = runner

    def execute(self, request: LeanBacktestRequest) -> LeanBacktestResponse:
        """Execute the compatibility path and return its established response shape."""

        return self.execute_with_evidence(request).response

    def execute_with_evidence(self, request: LeanBacktestRequest) -> BacktestExecution:
        """Execute once and collect the versioned machine evidence from that execution."""

        total_started = perf_counter_ns()
        stage_started = perf_counter_ns()
        issues = collect_semantic_issues(request.strategy)
        validation_ms = _elapsed_ms(stage_started)
        if issues:
            raise InvalidStrategyError(
                tuple(ValidationIssueData(path=item.path, message=item.message) for item in issues)
            )
        try:
            stage_started = perf_counter_ns()
            plan = compile_strategy_to_lean_plan(request.strategy)
            compiler_ms = _elapsed_ms(stage_started)
        except LeanLoweringError as exc:
            raise UnsupportedStrategyError(str(exc)) from exc
        settings = CSharpGenerationSettings(
            start_date=request.config.start_date,
            end_date=request.config.end_date,
            initial_cash=request.config.initial_cash,
        )
        stage_started = perf_counter_ns()
        generated_csharp = generate_csharp(plan, settings)
        codegen_ms = _elapsed_ms(stage_started)
        artifact = self.runner.run(generated_csharp, dataset_id=request.config.dataset_id)
        stage_started = perf_counter_ns()
        result = normalize_lean_result(artifact.result_payload)
        normalization_ms = _elapsed_ms(stage_started)
        return BacktestExecution(
            response=LeanBacktestResponse(
                strategy_hash=strategy_hash(request.strategy),
                config=request.config,
                result=result,
                timings=BacktestTimings(
                    validation_ms=validation_ms,
                    compiler_ms=compiler_ms,
                    codegen_ms=codegen_ms,
                    csharp_compile_ms=artifact.timings.csharp_compile_ms,
                    lean_execution_ms=artifact.timings.lean_execution_ms,
                    result_load_ms=artifact.timings.result_load_ms,
                    normalization_ms=normalization_ms,
                    total_ms=_elapsed_ms(total_started),
                ),
            ),
            decision_events=collect_decision_evidence(artifact.log_text),
        )

    @property
    def engine_image(self) -> str | None:
        image = getattr(self.runner, "image", None)
        return image if isinstance(image, str) else None


def _elapsed_ms(started_ns: int) -> int:
    return max(0, (perf_counter_ns() - started_ns) // 1_000_000)
