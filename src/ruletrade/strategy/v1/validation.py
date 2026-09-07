from __future__ import annotations

from dataclasses import dataclass

from ruletrade.strategy.v1.models import (
    Action,
    ArithmeticExpression,
    AverageCostExpression,
    BooleanExpression,
    BuyAction,
    CanonicalStrategyV1,
    ComparisonExpression,
    EmitSignalAction,
    Expression,
    IncrementStateAction,
    IndicatorExpression,
    LiquidateAction,
    LiteralExpression,
    NotExpression,
    ParameterRefExpression,
    PriceExpression,
    RebalanceAction,
    SellAction,
    SetStateAction,
    SetTargetAction,
    StateRefExpression,
)
from ruletrade.strategy.v1.registry import (
    BUILTIN_REGISTRY,
    PrimitiveCategory,
    PrimitiveRegistry,
)
from ruletrade.strategy.v1.types import NUMERIC_TYPES, ValueType, value_matches_type


@dataclass(frozen=True)
class SemanticIssue:
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


class StrategySemanticError(ValueError):
    def __init__(self, issues: list[SemanticIssue]) -> None:
        self.issues = tuple(issues)
        super().__init__("; ".join(str(issue) for issue in issues))


class _TypeChecker:
    def __init__(self, strategy: CanonicalStrategyV1) -> None:
        self.parameters = {
            definition.id: definition.value_type
            for definition in strategy.definitions.parameters
        }
        self.state = {
            definition.id: definition.value_type
            for definition in strategy.definitions.state
        }

    def expression_type(self, expression: Expression, path: str) -> ValueType:
        if isinstance(expression, LiteralExpression):
            return expression.value_type
        if isinstance(expression, ParameterRefExpression):
            return self._lookup(self.parameters, expression.parameter_id, path, "parameter")
        if isinstance(expression, StateRefExpression):
            return self._lookup(self.state, expression.state_id, path, "state")
        if isinstance(expression, (PriceExpression, AverageCostExpression)):
            self.require(expression.asset, ValueType.ASSET, f"{path}.asset")
            return ValueType.MONEY
        if isinstance(expression, IndicatorExpression):
            self.require(expression.asset, ValueType.ASSET, f"{path}.asset")
            return ValueType.DECIMAL
        if isinstance(expression, ArithmeticExpression):
            left = self.expression_type(expression.left, f"{path}.left")
            right = self.expression_type(expression.right, f"{path}.right")
            return self._arithmetic_type(expression.operator, left, right, path)
        if isinstance(expression, ComparisonExpression):
            left = self.expression_type(expression.left, f"{path}.left")
            right = self.expression_type(expression.right, f"{path}.right")
            if left != right:
                raise StrategySemanticError(
                    [SemanticIssue(path, f"comparison operands differ: {left} vs {right}")]
                )
            return ValueType.BOOLEAN
        if isinstance(expression, BooleanExpression):
            for index, operand in enumerate(expression.operands):
                self.require(operand, ValueType.BOOLEAN, f"{path}.operands[{index}]")
            return ValueType.BOOLEAN
        if isinstance(expression, NotExpression):
            self.require(expression.operand, ValueType.BOOLEAN, f"{path}.operand")
            return ValueType.BOOLEAN
        raise StrategySemanticError([SemanticIssue(path, "unsupported expression")])

    def validate_action(self, action: Action, path: str) -> None:
        if isinstance(action, (BuyAction, SellAction)):
            self.require(action.asset, ValueType.ASSET, f"{path}.asset")
            self.require(action.quantity, ValueType.SHARES, f"{path}.quantity")
            return
        if isinstance(action, LiquidateAction):
            self.require(action.asset, ValueType.ASSET, f"{path}.asset")
            return
        if isinstance(action, SetTargetAction):
            self.require(action.asset, ValueType.ASSET, f"{path}.asset")
            self.require(action.weight, ValueType.PERCENTAGE, f"{path}.weight")
            return
        if isinstance(action, RebalanceAction):
            self.require(action.targets, ValueType.PORTFOLIO_TARGETS, f"{path}.targets")
            return
        if isinstance(action, SetStateAction):
            expected = self._lookup(self.state, action.state_id, path, "state")
            self.require(action.value, expected, f"{path}.value")
            return
        if isinstance(action, IncrementStateAction):
            expected = self._lookup(self.state, action.state_id, path, "state")
            if expected not in NUMERIC_TYPES:
                raise StrategySemanticError(
                    [SemanticIssue(path, f"cannot increment non-numeric state {action.state_id}")]
                )
            self.require(action.amount, expected, f"{path}.amount")
            return
        if isinstance(action, EmitSignalAction):
            if action.value is not None:
                self.expression_type(action.value, f"{path}.value")
            return
        raise StrategySemanticError([SemanticIssue(path, "unsupported action")])

    def require(self, expression: Expression, expected: ValueType, path: str) -> None:
        actual = self.expression_type(expression, path)
        if actual != expected:
            raise StrategySemanticError(
                [SemanticIssue(path, f"expected {expected}, got {actual}")]
            )

    @staticmethod
    def _lookup(
        values: dict[str, ValueType], key: str, path: str, label: str
    ) -> ValueType:
        try:
            return values[key]
        except KeyError as exc:
            raise StrategySemanticError(
                [SemanticIssue(path, f"unknown {label}: {key}")]
            ) from exc

    @staticmethod
    def _arithmetic_type(
        operator: str,
        left: ValueType,
        right: ValueType,
        path: str,
    ) -> ValueType:
        if left not in NUMERIC_TYPES or right not in NUMERIC_TYPES:
            raise StrategySemanticError(
                [SemanticIssue(path, "arithmetic operands must be numeric")]
            )
        if operator in {"add", "subtract"}:
            if left != right:
                raise StrategySemanticError(
                    [SemanticIssue(path, f"arithmetic operands differ: {left} vs {right}")]
                )
            return left
        if operator == "multiply":
            if left == ValueType.DECIMAL:
                return right
            if right == ValueType.DECIMAL:
                return left
            if left == ValueType.PERCENTAGE and right in {ValueType.MONEY, ValueType.SHARES}:
                return right
            if right == ValueType.PERCENTAGE and left in {ValueType.MONEY, ValueType.SHARES}:
                return left
        if operator == "divide":
            if right in {ValueType.DECIMAL, ValueType.PERCENTAGE}:
                return left
            if left == right:
                return ValueType.DECIMAL
        raise StrategySemanticError(
            [SemanticIssue(path, f"unsupported arithmetic types: {left} {operator} {right}")]
        )


def collect_semantic_issues(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
) -> tuple[SemanticIssue, ...]:
    issues: list[SemanticIssue] = []
    components = {component.id: component for component in strategy.graph.components}
    asset_sets = {definition.id for definition in strategy.definitions.asset_sets}
    primitive_specs = {}

    for component in strategy.graph.components:
        path = f"graph.components[{component.id}]"
        try:
            primitive = registry.get(component.primitive)
        except KeyError:
            issues.append(SemanticIssue(f"{path}.primitive", f"unknown primitive: {component.primitive}"))
            continue
        primitive_specs[component.id] = primitive
        fields = {field.name: field for field in primitive.fields}
        unknown = sorted(set(component.config) - set(fields))
        for name in unknown:
            issues.append(SemanticIssue(f"{path}.config.{name}", "unknown field"))
        for field in primitive.fields:
            if field.required and field.name not in component.config:
                issues.append(SemanticIssue(f"{path}.config.{field.name}", "required field is missing"))
            if field.name in component.config and not value_matches_type(
                component.config[field.name], field.value_type
            ):
                issues.append(
                    SemanticIssue(
                        f"{path}.config.{field.name}",
                        f"value does not match {field.value_type}",
                    )
                )
        if component.primitive == "asset_set@1":
            ref = component.config.get("asset_set_ref")
            if isinstance(ref, str) and ref not in asset_sets:
                issues.append(SemanticIssue(f"{path}.config.asset_set_ref", f"unknown asset set: {ref}"))
        if component.primitive == "random_select@1":
            count = component.config.get("count")
            if isinstance(count, int) and count <= 0:
                issues.append(SemanticIssue(f"{path}.config.count", "must be greater than zero"))
            resample = component.config.get("resample", "per_event")
            if resample not in {"once", "per_event"}:
                issues.append(SemanticIssue(f"{path}.config.resample", "must be once or per_event"))
        if component.primitive == "monthly@1":
            day = component.config.get("day", 1)
            if isinstance(day, int) and not 1 <= day <= 31:
                issues.append(SemanticIssue(f"{path}.config.day", "must be between 1 and 31"))
        if component.primitive == "equal_weight@1":
            total = component.config.get("total")
            try:
                valid_total = 0 < float(total) <= 1
            except (TypeError, ValueError):
                valid_total = False
            if total is not None and not valid_total:
                issues.append(SemanticIssue(f"{path}.config.total", "must be greater than 0 and at most 1"))
        if primitive.category == PrimitiveCategory.RULE:
            if component.condition is None:
                issues.append(SemanticIssue(f"{path}.condition", "rule condition is required"))
            if not component.actions:
                issues.append(SemanticIssue(f"{path}.actions", "rule must contain at least one action"))
        elif component.condition is not None or component.actions:
            issues.append(SemanticIssue(path, "condition/actions are only valid on rule components"))

    inbound: set[tuple[str, str]] = set()
    connection_keys: set[tuple[str, str, str, str]] = set()
    dependency_edges: dict[str, set[str]] = {component_id: set() for component_id in components}
    for index, connection in enumerate(strategy.graph.connections):
        path = f"graph.connections[{index}]"
        source = primitive_specs.get(connection.source.component_id)
        target = primitive_specs.get(connection.target.component_id)
        if source is None:
            issues.append(SemanticIssue(f"{path}.source", "source component is missing or invalid"))
            continue
        if target is None:
            issues.append(SemanticIssue(f"{path}.target", "target component is missing or invalid"))
            continue
        source_ports = {port.name: port for port in source.outputs}
        target_ports = {port.name: port for port in target.inputs}
        source_port = source_ports.get(connection.source.port)
        target_port = target_ports.get(connection.target.port)
        if source_port is None:
            issues.append(SemanticIssue(f"{path}.source.port", "unknown output port"))
        if target_port is None:
            issues.append(SemanticIssue(f"{path}.target.port", "unknown input port"))
        if source_port and target_port and source_port.value_type != target_port.value_type:
            issues.append(
                SemanticIssue(
                    path,
                    f"port type mismatch: {source_port.value_type} -> {target_port.value_type}",
                )
            )
        key = (connection.target.component_id, connection.target.port)
        if key in inbound and target_port and not target_port.multiple:
            issues.append(SemanticIssue(f"{path}.target", "input port already has a connection"))
        inbound.add(key)
        connection_key = (
            connection.source.component_id,
            connection.source.port,
            connection.target.component_id,
            connection.target.port,
        )
        if connection_key in connection_keys:
            issues.append(SemanticIssue(path, "duplicate connection"))
        connection_keys.add(connection_key)
        if connection.source.component_id in components and connection.target.component_id in components:
            dependency_edges[connection.source.component_id].add(connection.target.component_id)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(component_id: str) -> bool:
        if component_id in visiting:
            return True
        if component_id in visited:
            return False
        visiting.add(component_id)
        if any(visit(target_id) for target_id in dependency_edges[component_id]):
            return True
        visiting.remove(component_id)
        visited.add(component_id)
        return False

    if any(visit(component_id) for component_id in components if component_id not in visited):
        issues.append(SemanticIssue("graph.connections", "component dependency graph contains a cycle"))

    for component_id, primitive in primitive_specs.items():
        for port in primitive.inputs:
            if port.required and (component_id, port.name) not in inbound:
                issues.append(
                    SemanticIssue(
                        f"graph.components[{component_id}].inputs.{port.name}",
                        "required input is not connected",
                    )
                )

    for index, entrypoint in enumerate(strategy.entrypoints):
        path = f"entrypoints[{index}]"
        event = primitive_specs.get(entrypoint.event_component_id)
        if event is None:
            issues.append(SemanticIssue(f"{path}.event_component_id", "event component is missing"))
        elif event.category != PrimitiveCategory.EVENT:
            issues.append(SemanticIssue(f"{path}.event_component_id", "component is not an event"))
        if entrypoint.target_component_id not in components:
            issues.append(SemanticIssue(f"{path}.target_component_id", "target component is missing"))

    checker = _TypeChecker(strategy)
    for component in strategy.graph.components:
        if component.condition is not None:
            try:
                checker.require(
                    component.condition,
                    ValueType.BOOLEAN,
                    f"graph.components[{component.id}].condition",
                )
            except StrategySemanticError as exc:
                issues.extend(exc.issues)
        for index, action in enumerate(component.actions):
            try:
                checker.validate_action(
                    action,
                    f"graph.components[{component.id}].actions[{index}]",
                )
            except StrategySemanticError as exc:
                issues.extend(exc.issues)

    return tuple(issues)


def validate_strategy_v1(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
) -> None:
    issues = list(collect_semantic_issues(strategy, registry))
    if issues:
        raise StrategySemanticError(issues)
