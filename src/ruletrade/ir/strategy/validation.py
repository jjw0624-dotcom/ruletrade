from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from ruletrade.ir.strategy.model import (
    AssetSetOp,
    EqualWeightOp,
    FilterOp,
    FirstNonEmptyTargetsOp,
    IRType,
    MergeTargetsOp,
    MonthlyScheduleOp,
    QuarterlyScheduleOp,
    RandomNOp,
    RankOp,
    RebalanceOp,
    RetainTargetsOp,
    ScaleTargetsOp,
    StrategyIR,
    StrategyIROperation,
    TopNOp,
    TrailingReturnOp,
)


@dataclass(frozen=True)
class IRValidationIssue:
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


class IRValidationError(ValueError):
    def __init__(self, issues: tuple[IRValidationIssue, ...]) -> None:
        self.issues = issues
        super().__init__("; ".join(str(issue) for issue in issues))


def _result_type(operation: StrategyIROperation) -> IRType:
    if isinstance(operation, (MonthlyScheduleOp, QuarterlyScheduleOp)):
        return IRType.EVENT
    if isinstance(operation, (AssetSetOp, RandomNOp, TopNOp)):
        return IRType.ASSET_SET
    if isinstance(operation, (TrailingReturnOp, FilterOp)):
        return IRType.ASSET_SCORES
    if isinstance(operation, RankOp):
        return IRType.RANKED_ASSETS
    if isinstance(
        operation,
        (EqualWeightOp, ScaleTargetsOp, RetainTargetsOp, MergeTargetsOp, FirstNonEmptyTargetsOp),
    ):
        return IRType.PORTFOLIO_TARGETS
    if isinstance(operation, RebalanceOp):
        return IRType.EFFECT
    raise TypeError(f"unknown IR operation type: {type(operation).__name__}")


def _operands(operation: StrategyIROperation) -> tuple[tuple[str, str, IRType], ...]:
    if isinstance(operation, RandomNOp):
        return (("assets", operation.assets, IRType.ASSET_SET),)
    if isinstance(operation, TrailingReturnOp):
        return (("assets", operation.assets, IRType.ASSET_SET),)
    if isinstance(operation, FilterOp):
        return (("scores", operation.scores, IRType.ASSET_SCORES),)
    if isinstance(operation, RankOp):
        return (("scores", operation.scores, IRType.ASSET_SCORES),)
    if isinstance(operation, TopNOp):
        return (("ranked", operation.ranked, IRType.RANKED_ASSETS),)
    if isinstance(operation, EqualWeightOp):
        return (("assets", operation.assets, IRType.ASSET_SET),)
    if isinstance(operation, ScaleTargetsOp):
        return (("targets", operation.targets, IRType.PORTFOLIO_TARGETS),)
    if isinstance(operation, RetainTargetsOp):
        return (("targets", operation.targets, IRType.PORTFOLIO_TARGETS),)
    if isinstance(operation, MergeTargetsOp):
        return (
            ("left", operation.left, IRType.PORTFOLIO_TARGETS),
            ("right", operation.right, IRType.PORTFOLIO_TARGETS),
        )
    if isinstance(operation, FirstNonEmptyTargetsOp):
        return (
            ("primary", operation.primary, IRType.PORTFOLIO_TARGETS),
            ("fallback", operation.fallback, IRType.PORTFOLIO_TARGETS),
        )
    if isinstance(operation, RebalanceOp):
        return (("targets", operation.targets, IRType.PORTFOLIO_TARGETS),)
    return ()


def collect_ir_validation_issues(strategy_ir: StrategyIR) -> tuple[IRValidationIssue, ...]:
    issues: list[IRValidationIssue] = []
    if not strategy_ir.strategy_identity:
        issues.append(IRValidationIssue("strategy_identity", "strategy identity is required"))
    if not strategy_ir.entrypoints:
        issues.append(IRValidationIssue("entrypoints", "at least one entrypoint is required"))
    operations: dict[str, StrategyIROperation] = {}
    known_types = (
        MonthlyScheduleOp,
        QuarterlyScheduleOp,
        AssetSetOp,
        RandomNOp,
        TrailingReturnOp,
        FilterOp,
        RankOp,
        TopNOp,
        EqualWeightOp,
        ScaleTargetsOp,
        RetainTargetsOp,
        MergeTargetsOp,
        FirstNonEmptyTargetsOp,
        RebalanceOp,
    )
    for index, operation in enumerate(strategy_ir.operations):
        path = f"operations[{index}]"
        if not isinstance(operation, known_types):
            issues.append(IRValidationIssue(path, "unknown IR operation"))
            continue
        expected_operation_id = type(operation).operation
        if operation.operation != expected_operation_id:
            issues.append(
                IRValidationIssue(
                    f"{path}.operation",
                    f"expected operation id {expected_operation_id}",
                )
            )
        if not operation.id:
            issues.append(IRValidationIssue(f"{path}.id", "operation id is required"))
        elif operation.id in operations:
            issues.append(IRValidationIssue(f"{path}.id", f"duplicate operation id: {operation.id}"))
        else:
            operations[operation.id] = operation
        if not operation.provenance.component_id:
            issues.append(IRValidationIssue(f"{path}.provenance", "source component id is required"))
        if isinstance(operation, MonthlyScheduleOp) and not 1 <= operation.day <= 31:
            issues.append(IRValidationIssue(f"{path}.day", "monthly day must be between 1 and 31"))
        if isinstance(operation, QuarterlyScheduleOp) and not 1 <= operation.day <= 31:
            issues.append(IRValidationIssue(f"{path}.day", "quarterly day must be between 1 and 31"))
        if isinstance(operation, AssetSetOp) and (
            not operation.symbols or len(set(operation.symbols)) != len(operation.symbols)
        ):
            issues.append(
                IRValidationIssue(f"{path}.symbols", "asset set must contain unique symbols")
            )
        if isinstance(operation, RandomNOp):
            if operation.count < 1:
                issues.append(IRValidationIssue(f"{path}.count", "random count must be positive"))
            if operation.resample not in {"once", "per_event"}:
                issues.append(IRValidationIssue(f"{path}.resample", "unsupported random resample mode"))
        if isinstance(operation, TrailingReturnOp) and operation.lookback_bars < 1:
            issues.append(IRValidationIssue(f"{path}.lookback_bars", "lookback must be positive"))
        if isinstance(operation, FilterOp):
            if operation.operator != "gt":
                issues.append(
                    IRValidationIssue(f"{path}.operator", "only strict gt filter is supported")
                )
            if not isinstance(operation.threshold, Decimal) or not operation.threshold.is_finite():
                issues.append(
                    IRValidationIssue(f"{path}.threshold", "filter threshold must be finite decimal")
                )
        if isinstance(operation, RankOp) and operation.direction != "descending":
            issues.append(IRValidationIssue(f"{path}.direction", "only descending rank is supported"))
        if isinstance(operation, TopNOp) and operation.count < 1:
            issues.append(IRValidationIssue(f"{path}.count", "Top N count must be positive"))
        if isinstance(operation, EqualWeightOp) and not 0 < operation.total_weight <= 1:
            issues.append(
                IRValidationIssue(
                    f"{path}.total_weight",
                    "weight must be greater than 0 and at most 1",
                )
            )
        if isinstance(operation, ScaleTargetsOp) and not 0 < operation.factor <= 1:
            issues.append(
                IRValidationIssue(
                    f"{path}.factor",
                    "scale factor must be greater than 0 and at most 1",
                )
            )
        if (
            isinstance(operation, FirstNonEmptyTargetsOp)
            and operation.primary == operation.fallback
        ):
            issues.append(
                IRValidationIssue(
                    f"{path}.fallback",
                    "fallback targets must differ from primary targets",
                )
            )

    dependencies: dict[str, set[str]] = {operation_id: set() for operation_id in operations}
    for operation_id, operation in operations.items():
        for operand_name, operand_id, expected_type in _operands(operation):
            operand = operations.get(operand_id)
            path = f"operations[{operation_id}].{operand_name}"
            if operand is None:
                issues.append(IRValidationIssue(path, f"unknown operand: {operand_id}"))
                continue
            dependencies[operation_id].add(operand_id)
            actual_type = _result_type(operand)
            if actual_type != expected_type:
                issues.append(
                    IRValidationIssue(path, f"expected {expected_type}, got {actual_type}")
                )
        if isinstance(operation, RandomNOp):
            source = operations.get(operation.assets)
            if isinstance(source, AssetSetOp) and operation.count > len(source.symbols):
                issues.append(
                    IRValidationIssue(
                        f"operations[{operation_id}].count",
                        "RandomSelect count cannot exceed its asset set size",
                    )
                )
        if isinstance(operation, TopNOp):
            rank = operations.get(operation.ranked)
            scores = operations.get(rank.scores) if isinstance(rank, RankOp) else None
            if isinstance(scores, FilterOp):
                scores = operations.get(scores.scores)
            source = operations.get(scores.assets) if isinstance(scores, TrailingReturnOp) else None
            if isinstance(source, AssetSetOp) and operation.count > len(source.symbols):
                issues.append(
                    IRValidationIssue(
                        f"operations[{operation_id}].count",
                        "Top N count cannot exceed its asset set size",
                    )
                )

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(operation_id: str) -> bool:
        if operation_id in visiting:
            return True
        if operation_id in visited:
            return False
        visiting.add(operation_id)
        if any(visit(dependency) for dependency in dependencies[operation_id]):
            return True
        visiting.remove(operation_id)
        visited.add(operation_id)
        return False

    if any(visit(operation_id) for operation_id in operations if operation_id not in visited):
        issues.append(IRValidationIssue("operations", "IR dataflow contains a cycle"))

    reachable: set[str] = set()

    def mark(operation_id: str) -> None:
        if operation_id in reachable or operation_id not in operations:
            return
        reachable.add(operation_id)
        for _, dependency, _ in _operands(operations[operation_id]):
            mark(dependency)

    for index, entrypoint in enumerate(strategy_ir.entrypoints):
        event = operations.get(entrypoint.event)
        target = operations.get(entrypoint.target)
        path = f"entrypoints[{index}]"
        if not isinstance(event, (MonthlyScheduleOp, QuarterlyScheduleOp)):
            issues.append(IRValidationIssue(f"{path}.event", "entrypoint event must be a schedule"))
        if not isinstance(target, (RetainTargetsOp, RebalanceOp)):
            issues.append(
                IRValidationIssue(
                    f"{path}.target",
                    "entrypoint target must refresh retained targets or rebalance",
                )
            )
        mark(entrypoint.event)
        mark(entrypoint.target)

    entrypoint_targets = {item.target for item in strategy_ir.entrypoints}
    for operation in operations.values():
        if isinstance(operation, RetainTargetsOp) and operation.id not in entrypoint_targets:
            issues.append(
                IRValidationIssue(
                    f"operations[{operation.id}]",
                    "retained targets must have a scheduled refresh entrypoint",
                )
            )

    unused = sorted(set(operations) - reachable)
    if unused:
        issues.append(IRValidationIssue("operations", f"unused operations: {', '.join(unused)}"))
    return tuple(issues)


def validate_strategy_ir(strategy_ir: StrategyIR) -> None:
    issues = collect_ir_validation_issues(strategy_ir)
    if issues:
        raise IRValidationError(issues)
