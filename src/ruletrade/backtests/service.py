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
from ruletrade.diagnostics import elapsed_ms, serialized_bytes
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
        validation_ms = elapsed_ms(stage_started)
        if issues:
            raise InvalidStrategyError(
                tuple(ValidationIssueData(path=item.path, message=item.message) for item in issues)
            )
        try:
            stage_started = perf_counter_ns()
            plan = compile_strategy_to_lean_plan(request.strategy)
            compiler_ms = elapsed_ms(stage_started)
        except LeanLoweringError as exc:
            raise UnsupportedStrategyError(str(exc)) from exc
        settings = CSharpGenerationSettings(
            start_date=request.config.start_date,
            end_date=request.config.end_date,
            initial_cash=request.config.initial_cash,
        )
        stage_started = perf_counter_ns()
        generated_csharp = generate_csharp(plan, settings)
        codegen_ms = elapsed_ms(stage_started)
        artifact = self.runner.run(generated_csharp, dataset_id=request.config.dataset_id)
        stage_started = perf_counter_ns()
        result = normalize_lean_result(artifact.result_payload)
        normalization_ms = elapsed_ms(stage_started)
        stage_started = perf_counter_ns()
        decision_events = collect_decision_evidence(artifact.log_text)
        evidence_collection_ms = elapsed_ms(stage_started)
        measured_stage_total = sum(
            (
                validation_ms,
                compiler_ms,
                codegen_ms,
                artifact.timings.csharp_compile_ms,
                artifact.timings.lean_execution_ms,
                artifact.timings.result_load_ms,
                normalization_ms,
                evidence_collection_ms,
            )
        )
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
                    evidence_collection_ms=evidence_collection_ms,
                    total_ms=max(elapsed_ms(total_started), measured_stage_total),
                ),
                diagnostics={
                    "canonical_bytes": serialized_bytes(request.strategy),
                    "generated_csharp_bytes": len(generated_csharp.encode("utf-8")),
                    "normalized_result_bytes": serialized_bytes(result),
                    "equity_points": len(result.equity_curve),
                    "evidence_events": len(decision_events),
                    "evidence_bytes": serialized_bytes(
                        [event.model_dump(mode="json") for event in decision_events]
                    ),
                },
            ),
            decision_events=decision_events,
        )

    @property
    def engine_image(self) -> str | None:
        image = getattr(self.runner, "image", None)
        return image if isinstance(image, str) else None
