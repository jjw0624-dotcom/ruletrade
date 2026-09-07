from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ruletrade.strategy.v1.types import ValueType, normalize_typed_value, value_matches_type


Identifier = Annotated[
    str,
    Field(min_length=1, max_length=100, pattern=r"^[A-Za-z][A-Za-z0-9_-]*$"),
]
Symbol = Annotated[
    str,
    Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:-]+$"),
]


class FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class StrategyMetadata(FrozenModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    description: Annotated[str, Field(max_length=2000)] = ""
    tags: tuple[str, ...] = ()


class AssetSetDefinition(FrozenModel):
    id: Identifier
    assets: Annotated[list[Symbol], Field(min_length=1)]

    @field_validator("assets", mode="before")
    @classmethod
    def normalize_assets(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            return value
        if not all(isinstance(item, str) for item in value):
            return value
        normalized = [item.strip().upper() for item in value]
        if len(normalized) != len(set(normalized)):
            raise ValueError("asset set symbols must be unique")
        return normalized


class ParameterDefinition(FrozenModel):
    id: Identifier
    value_type: ValueType
    default: Any

    @model_validator(mode="before")
    @classmethod
    def normalize_default(cls, value: object) -> object:
        if not isinstance(value, dict) or "value_type" not in value or "default" not in value:
            return value
        normalized = dict(value)
        value_type = ValueType(normalized["value_type"])
        if value_matches_type(normalized["default"], value_type):
            normalized["default"] = normalize_typed_value(normalized["default"], value_type)
        return normalized

    @model_validator(mode="after")
    def validate_default(self) -> "ParameterDefinition":
        if not value_matches_type(self.default, self.value_type):
            raise ValueError(f"parameter default does not match {self.value_type}")
        return self


class StateDefinition(FrozenModel):
    id: Identifier
    value_type: ValueType
    initial: Any

    @model_validator(mode="before")
    @classmethod
    def normalize_initial(cls, value: object) -> object:
        if not isinstance(value, dict) or "value_type" not in value or "initial" not in value:
            return value
        normalized = dict(value)
        value_type = ValueType(normalized["value_type"])
        if value_matches_type(normalized["initial"], value_type):
            normalized["initial"] = normalize_typed_value(normalized["initial"], value_type)
        return normalized

    @model_validator(mode="after")
    def validate_initial(self) -> "StateDefinition":
        if not value_matches_type(self.initial, self.value_type):
            raise ValueError(f"state initial value does not match {self.value_type}")
        return self


class StrategyDefinitions(FrozenModel):
    asset_sets: tuple[AssetSetDefinition, ...] = ()
    parameters: tuple[ParameterDefinition, ...] = ()
    state: tuple[StateDefinition, ...] = ()

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "StrategyDefinitions":
        for label, items in (
            ("asset set", self.asset_sets),
            ("parameter", self.parameters),
            ("state", self.state),
        ):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"{label} ids must be unique")
        return self


class LiteralExpression(FrozenModel):
    kind: Literal["literal"] = "literal"
    value_type: ValueType
    value: Any

    @model_validator(mode="before")
    @classmethod
    def normalize_value(cls, value: object) -> object:
        if not isinstance(value, dict) or "value_type" not in value or "value" not in value:
            return value
        normalized = dict(value)
        value_type = ValueType(normalized["value_type"])
        if value_matches_type(normalized["value"], value_type):
            normalized["value"] = normalize_typed_value(normalized["value"], value_type)
        return normalized

    @model_validator(mode="after")
    def validate_value(self) -> "LiteralExpression":
        if not value_matches_type(self.value, self.value_type):
            raise ValueError(f"literal value does not match {self.value_type}")
        return self


class ParameterRefExpression(FrozenModel):
    kind: Literal["parameter_ref"] = "parameter_ref"
    parameter_id: Identifier


class StateRefExpression(FrozenModel):
    kind: Literal["state_ref"] = "state_ref"
    state_id: Identifier


class PriceExpression(FrozenModel):
    kind: Literal["price"] = "price"
    asset: "Expression"


class AverageCostExpression(FrozenModel):
    kind: Literal["average_cost"] = "average_cost"
    asset: "Expression"


class IndicatorExpression(FrozenModel):
    kind: Literal["indicator"] = "indicator"
    indicator_id: Annotated[
        str,
        Field(pattern=r"^[a-z][a-z0-9_]*@[1-9][0-9]*$"),
    ]
    asset: "Expression"
    parameters: dict[str, Any] = Field(default_factory=dict)


class ArithmeticExpression(FrozenModel):
    kind: Literal["arithmetic"] = "arithmetic"
    operator: Literal["add", "subtract", "multiply", "divide"]
    left: "Expression"
    right: "Expression"


class ComparisonExpression(FrozenModel):
    kind: Literal["comparison"] = "comparison"
    operator: Literal["lt", "lte", "eq", "neq", "gte", "gt"]
    left: "Expression"
    right: "Expression"


class BooleanExpression(FrozenModel):
    kind: Literal["boolean"] = "boolean"
    operator: Literal["and", "or"]
    operands: Annotated[list["Expression"], Field(min_length=2)]


class NotExpression(FrozenModel):
    kind: Literal["not"] = "not"
    operand: "Expression"


Expression = Annotated[
    LiteralExpression
    | ParameterRefExpression
    | StateRefExpression
    | PriceExpression
    | AverageCostExpression
    | IndicatorExpression
    | ArithmeticExpression
    | ComparisonExpression
    | BooleanExpression
    | NotExpression,
    Field(discriminator="kind"),
]


class BuyAction(FrozenModel):
    kind: Literal["buy"] = "buy"
    asset: Expression
    quantity: Expression


class SellAction(FrozenModel):
    kind: Literal["sell"] = "sell"
    asset: Expression
    quantity: Expression


class LiquidateAction(FrozenModel):
    kind: Literal["liquidate"] = "liquidate"
    asset: Expression


class SetTargetAction(FrozenModel):
    kind: Literal["set_target"] = "set_target"
    asset: Expression
    weight: Expression


class RebalanceAction(FrozenModel):
    kind: Literal["rebalance"] = "rebalance"
    targets: Expression


class SetStateAction(FrozenModel):
    kind: Literal["set_state"] = "set_state"
    state_id: Identifier
    value: Expression


class IncrementStateAction(FrozenModel):
    kind: Literal["increment_state"] = "increment_state"
    state_id: Identifier
    amount: Expression


class EmitSignalAction(FrozenModel):
    kind: Literal["emit_signal"] = "emit_signal"
    name: Annotated[str, Field(min_length=1, max_length=100)]
    value: Expression | None = None


Action = Annotated[
    BuyAction
    | SellAction
    | LiquidateAction
    | SetTargetAction
    | RebalanceAction
    | SetStateAction
    | IncrementStateAction
    | EmitSignalAction,
    Field(discriminator="kind"),
]


class Component(FrozenModel):
    id: Identifier
    primitive: Annotated[
        str,
        Field(pattern=r"^[a-z][a-z0-9_]*@[1-9][0-9]*$"),
    ]
    config: dict[str, Any] = Field(default_factory=dict)
    condition: Expression | None = None
    actions: tuple[Action, ...] = ()


class PortReference(FrozenModel):
    component_id: Identifier
    port: Annotated[str, Field(min_length=1, max_length=100)]


class Connection(FrozenModel):
    source: PortReference
    target: PortReference


class Entrypoint(FrozenModel):
    event_component_id: Identifier
    target_component_id: Identifier


class StrategyGraph(FrozenModel):
    components: Annotated[tuple[Component, ...], Field(min_length=1)]
    connections: tuple[Connection, ...] = ()

    @model_validator(mode="after")
    def validate_component_ids(self) -> "StrategyGraph":
        ids = [component.id for component in self.components]
        if len(ids) != len(set(ids)):
            raise ValueError("component ids must be unique")
        return self


class CanonicalStrategyV1(FrozenModel):
    api_version: Literal["ruletrade.dev/strategy/v1"] = "ruletrade.dev/strategy/v1"
    metadata: StrategyMetadata
    random_seed: int = 0
    definitions: StrategyDefinitions = Field(default_factory=StrategyDefinitions)
    graph: StrategyGraph
    entrypoints: Annotated[tuple[Entrypoint, ...], Field(min_length=1)]


_expression_namespace = {"Expression": Expression}
for _model in (
    PriceExpression,
    AverageCostExpression,
    IndicatorExpression,
    ArithmeticExpression,
    ComparisonExpression,
    BooleanExpression,
    NotExpression,
):
    _model.model_rebuild(_types_namespace=_expression_namespace)
