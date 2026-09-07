from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

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
    DefinitionReference,
    PrimitiveCategory,
    PrimitiveFieldSpec,
    PrimitiveRegistry,
    PrimitiveSpec,
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


DefinitionIds = dict[DefinitionReference, set[str]]


def _definition_ids(strategy: CanonicalStrategyV1) -> DefinitionIds:
    return {
        DefinitionReference.ASSET_SET: {
            definition.id for definition in strategy.definitions.asset_sets
        },
    }


def _field_issues(
    fields: tuple[PrimitiveFieldSpec, ...],
    values: dict[str, object],
    path: str,
    definition_ids: DefinitionIds,
) -> list[SemanticIssue]:
    issues: list[SemanticIssue] = []
    by_name = {field.name: field for field in fields}

    for name in sorted(set(values) - set(by_name)):
        issues.append(SemanticIssue(f"{path}.{name}", "unknown field"))

    for field in fields:
        field_path = f"{path}.{field.name}"
        if field.name not in values:
            if field.required:
                issues.append(SemanticIssue(field_path, "required field is missing"))
            continue

        value = values[field.name]
        if not value_matches_type(value, field.value_type):
            issues.append(SemanticIssue(field_path, f"value does not match {field.value_type}"))
            continue
        if field.choices and value not in field.choices:
            choices = ", ".join(str(choice) for choice in field.choices)
            issues.append(SemanticIssue(field_path, f"must be one of: {choices}"))
        if field.minimum is not None or field.maximum is not None:
            try:
                number = Decimal(str(value))
            except (InvalidOperation, TypeError, ValueError):
                number = None
            if number is not None and field.minimum is not None:
                below_minimum = number < field.minimum
                at_exclusive_minimum = field.exclusive_minimum and number == field.minimum
                if below_minimum or at_exclusive_minimum:
                    qualifier = "greater than" if field.exclusive_minimum else "at least"
                    issues.append(
                        SemanticIssue(field_path, f"must be {qualifier} {field.minimum}")
                    )
            if number is not None and field.maximum is not None and number > field.maximum:
                issues.append(SemanticIssue(field_path, f"must be at most {field.maximum}"))
        if field.reference is not None:
            if not isinstance(value, str) or value not in definition_ids[field.reference]:
                reference_label = field.reference.value.replace("_", " ")
                issues.append(
                    SemanticIssue(field_path, f"unknown {reference_label}: {value}")
                )

    return issues


class _TypeChecker:
    def __init__(
        self,
        strategy: CanonicalStrategyV1,
        registry: PrimitiveRegistry,
        definition_ids: DefinitionIds,
    ) -> None:
        self.registry = registry
        self.definition_ids = definition_ids
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
            return ValueType.MONEY_PER_SHARE
        if isinstance(expression, IndicatorExpression):
            self.require(expression.asset, ValueType.ASSET, f"{path}.asset")
            try:
                indicator = self.registry.get(expression.indicator_id)
            except KeyError as exc:
                raise StrategySemanticError(
                    [SemanticIssue(f"{path}.indicator_id", f"unknown indicator: {expression.indicator_id}")]
                ) from exc
            if indicator.category != PrimitiveCategory.INDICATOR or indicator.result_type is None:
                raise StrategySemanticError(
                    [SemanticIssue(f"{path}.indicator_id", "registered primitive is not an indicator")]
                )
            field_issues = _field_issues(
                indicator.fields,
                expression.parameters,
                f"{path}.parameters",
                self.definition_ids,
            )
            if field_issues:
                raise StrategySemanticError(field_issues)
            return indicator.result_type
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
            if expression.operator not in {"eq", "neq"} and left not in NUMERIC_TYPES | {
                ValueType.DATETIME,
                ValueType.DURATION,
            }:
                raise StrategySemanticError(
                    [SemanticIssue(path, f"{expression.operator} is not valid for {left}")]
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
            scalable = {ValueType.MONEY, ValueType.MONEY_PER_SHARE, ValueType.SHARES}
            if left == ValueType.PERCENTAGE and right in scalable:
                return right
            if right == ValueType.PERCENTAGE and left in scalable:
                return left
            if {left, right} == {ValueType.MONEY_PER_SHARE, ValueType.SHARES}:
                return ValueType.MONEY
        if operator == "divide":
            if right in {ValueType.DECIMAL, ValueType.PERCENTAGE}:
                return left
            if left == ValueType.MONEY and right == ValueType.MONEY_PER_SHARE:
                return ValueType.SHARES
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
    definition_ids = _definition_ids(strategy)
    primitive_specs: dict[str, PrimitiveSpec] = {}

    for component in strategy.graph.components:
        path = f"graph.components[{component.id}]"
        try:
            primitive = registry.get(component.primitive)
        except KeyError:
            issues.append(SemanticIssue(f"{path}.primitive", f"unknown primitive: {component.primitive}"))
            continue
        primitive_specs[component.id] = primitive
        issues.extend(
            _field_issues(
                primitive.fields,
                component.config,
                f"{path}.config",
                definition_ids,
            )
        )
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

    checker = _TypeChecker(strategy, registry, definition_ids)
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
