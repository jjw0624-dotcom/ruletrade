from __future__ import annotations

from dataclasses import dataclass

from ruletrade.ir.strategy.model import (
    AssetSetOp,
    EqualWeightOp,
    IRType,
    MergeTargetsOp,
    MonthlyScheduleOp,
    RandomNOp,
    RebalanceOp,
    StrategyIR,
    StrategyIROperation,
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
    if isinstance(operation, MonthlyScheduleOp):
        return IRType.EVENT
    if isinstance(operation, (AssetSetOp, RandomNOp)):
        return IRType.ASSET_SET
    if isinstance(operation, (EqualWeightOp, MergeTargetsOp)):
        return IRType.PORTFOLIO_TARGETS
    if isinstance(operation, RebalanceOp):
        return IRType.EFFECT
    raise TypeError(f"unknown IR operation type: {type(operation).__name__}")


def _operands(operation: StrategyIROperation) -> tuple[tuple[str, str, IRType], ...]:
    if isinstance(operation, RandomNOp):
        return (("assets", operation.assets, IRType.ASSET_SET),)
    if isinstance(operation, EqualWeightOp):
        return (("assets", operation.assets, IRType.ASSET_SET),)
    if isinstance(operation, MergeTargetsOp):
        return (
            ("left", operation.left, IRType.PORTFOLIO_TARGETS),
            ("right", operation.right, IRType.PORTFOLIO_TARGETS),
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
        AssetSetOp,
        RandomNOp,
        EqualWeightOp,
        MergeTargetsOp,
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
        if isinstance(operation, EqualWeightOp) and not 0 < operation.total_weight <= 1:
            issues.append(
                IRValidationIssue(
                    f"{path}.total_weight",
                    "weight must be greater than 0 and at most 1",
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
        if not isinstance(event, MonthlyScheduleOp):
            issues.append(IRValidationIssue(f"{path}.event", "entrypoint event must be a schedule"))
        if not isinstance(target, RebalanceOp):
            issues.append(IRValidationIssue(f"{path}.target", "entrypoint target must be rebalance"))
        mark(entrypoint.event)
        mark(entrypoint.target)

    unused = sorted(set(operations) - reachable)
    if unused:
        issues.append(IRValidationIssue("operations", f"unused operations: {', '.join(unused)}"))
    return tuple(issues)


def validate_strategy_ir(strategy_ir: StrategyIR) -> None:
    issues = collect_ir_validation_issues(strategy_ir)
    if issues:
        raise IRValidationError(issues)
