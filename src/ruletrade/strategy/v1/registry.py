from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Any

from ruletrade.strategy.v1.types import ValueType


class PrimitiveCategory(StrEnum):
    EVENT = "event"
    TRANSFORM = "transform"
    RULE = "rule"
    ALLOCATOR = "allocator"
    EFFECT = "effect"
    INDICATOR = "indicator"


class BackendCapability(StrEnum):
    NATIVE = "native"
    FRAMEWORK = "framework"
    GENERATED = "generated"
    COMPOSITE = "composite"


class DefinitionReference(StrEnum):
    ASSET_SET = "asset_set"


@dataclass(frozen=True)
class PortSpec:
    name: str
    value_type: ValueType
    required: bool = True
    multiple: bool = False


@dataclass(frozen=True)
class PrimitiveFieldSpec:
    name: str
    value_type: ValueType
    required: bool = True
    default: Any = None
    minimum: Decimal | None = None
    maximum: Decimal | None = None
    exclusive_minimum: bool = False
    choices: tuple[Any, ...] = ()
    reference: DefinitionReference | None = None


@dataclass(frozen=True)
class PrimitiveSpec:
    id: str
    category: PrimitiveCategory
    inputs: tuple[PortSpec, ...] = ()
    outputs: tuple[PortSpec, ...] = ()
    fields: tuple[PrimitiveFieldSpec, ...] = ()
    authoring_views: frozenset[str] = frozenset()
    backend_capability: BackendCapability = BackendCapability.GENERATED
    implementation_id: str = ""
    result_type: ValueType | None = None


class PrimitiveRegistry:
    def __init__(self, primitives: tuple[PrimitiveSpec, ...] = ()) -> None:
        self._primitives: dict[str, PrimitiveSpec] = {}
        for primitive in primitives:
            self.register(primitive)

    def register(self, primitive: PrimitiveSpec) -> None:
        if primitive.id in self._primitives:
            raise ValueError(f"primitive already registered: {primitive.id}")
        if primitive.category == PrimitiveCategory.INDICATOR and primitive.result_type is None:
            raise ValueError("indicator primitives require a result type")
        self._primitives[primitive.id] = primitive

    def get(self, primitive_id: str) -> PrimitiveSpec:
        try:
            return self._primitives[primitive_id]
        except KeyError as exc:
            raise KeyError(f"unknown primitive: {primitive_id}") from exc

    def all(self) -> tuple[PrimitiveSpec, ...]:
        return tuple(self._primitives[key] for key in sorted(self._primitives))

    def resolve_config(self, primitive_id: str, config: dict[str, Any]) -> dict[str, Any]:
        primitive = self.get(primitive_id)
        resolved = {
            field.name: field.default
            for field in primitive.fields
            if not field.required and field.name not in config
        }
        resolved.update(config)
        return resolved


COMMON_VIEWS = frozenset({"guided", "rules", "flow", "blocks", "code"})


def build_builtin_registry() -> PrimitiveRegistry:
    asset_set_port = PortSpec("assets", ValueType.ASSET_SET)
    targets_port = PortSpec("targets", ValueType.PORTFOLIO_TARGETS)

    return PrimitiveRegistry(
        (
            PrimitiveSpec(
                id="daily@1",
                category=PrimitiveCategory.EVENT,
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="event.daily",
            ),
            PrimitiveSpec(
                id="monthly@1",
                category=PrimitiveCategory.EVENT,
                fields=(
                    PrimitiveFieldSpec(
                        "day",
                        ValueType.INTEGER,
                        required=False,
                        default=1,
                        minimum=Decimal("1"),
                        maximum=Decimal("31"),
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="event.monthly",
            ),
            PrimitiveSpec(
                id="quarterly@1",
                category=PrimitiveCategory.EVENT,
                fields=(
                    PrimitiveFieldSpec(
                        "day",
                        ValueType.INTEGER,
                        required=False,
                        default=1,
                        minimum=Decimal("1"),
                        maximum=Decimal("31"),
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="event.quarterly",
            ),
            PrimitiveSpec(
                id="asset_set@1",
                category=PrimitiveCategory.TRANSFORM,
                outputs=(asset_set_port,),
                fields=(
                    PrimitiveFieldSpec(
                        "asset_set_ref",
                        ValueType.STRING,
                        reference=DefinitionReference.ASSET_SET,
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="asset_set.named",
            ),
            PrimitiveSpec(
                id="random_select@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("assets", ValueType.ASSET_SET),),
                outputs=(PortSpec("selected", ValueType.ASSET_SET),),
                fields=(
                    PrimitiveFieldSpec("count", ValueType.INTEGER, minimum=Decimal("1")),
                    PrimitiveFieldSpec(
                        "resample",
                        ValueType.STRING,
                        required=False,
                        default="per_event",
                        choices=("once", "per_event"),
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="selection.random_n_v1",
            ),
            PrimitiveSpec(
                id="trailing_return@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("assets", ValueType.ASSET_SET),),
                outputs=(PortSpec("scores", ValueType.ASSET_SCORES),),
                fields=(
                    PrimitiveFieldSpec(
                        "lookback_bars",
                        ValueType.INTEGER,
                        minimum=Decimal("1"),
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="market.trailing_return",
            ),
            PrimitiveSpec(
                id="filter@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("scores", ValueType.ASSET_SCORES),),
                outputs=(PortSpec("scores", ValueType.ASSET_SCORES),),
                fields=(
                    PrimitiveFieldSpec(
                        "operator",
                        ValueType.STRING,
                        required=False,
                        default="gt",
                        choices=("gt",),
                    ),
                    PrimitiveFieldSpec("threshold", ValueType.PERCENTAGE),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="selection.filter",
            ),
            PrimitiveSpec(
                id="rank@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("scores", ValueType.ASSET_SCORES),),
                outputs=(PortSpec("ranked", ValueType.RANKED_ASSETS),),
                fields=(
                    PrimitiveFieldSpec(
                        "direction",
                        ValueType.STRING,
                        required=False,
                        default="descending",
                        choices=("descending",),
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="selection.rank",
            ),
            PrimitiveSpec(
                id="top_n@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("ranked", ValueType.RANKED_ASSETS),),
                outputs=(PortSpec("selected", ValueType.ASSET_SET),),
                fields=(
                    PrimitiveFieldSpec("count", ValueType.INTEGER, minimum=Decimal("1")),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="selection.top_n",
            ),
            PrimitiveSpec(
                id="cooldown@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("candidates", ValueType.ASSET_SET),),
                outputs=(PortSpec("eligible", ValueType.ASSET_SET),),
                fields=(
                    PrimitiveFieldSpec(
                        "duration",
                        ValueType.INTEGER,
                        minimum=Decimal("1"),
                    ),
                    PrimitiveFieldSpec(
                        "unit",
                        ValueType.STRING,
                        required=False,
                        default="trading_days",
                        choices=("trading_days",),
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.COMPOSITE,
                implementation_id="selection.cooldown",
            ),
            PrimitiveSpec(
                id="equal_weight@1",
                category=PrimitiveCategory.ALLOCATOR,
                inputs=(PortSpec("assets", ValueType.ASSET_SET),),
                outputs=(targets_port,),
                fields=(
                    PrimitiveFieldSpec(
                        "total",
                        ValueType.PERCENTAGE,
                        minimum=Decimal("0"),
                        maximum=Decimal("1"),
                        exclusive_minimum=True,
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="allocation.equal_weight",
            ),
            PrimitiveSpec(
                id="merge_targets@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(
                    PortSpec("left", ValueType.PORTFOLIO_TARGETS),
                    PortSpec("right", ValueType.PORTFOLIO_TARGETS),
                ),
                outputs=(targets_port,),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="targets.merge",
            ),
            PrimitiveSpec(
                id="fallback@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("primary", ValueType.PORTFOLIO_TARGETS),),
                outputs=(targets_port,),
                fields=(
                    PrimitiveFieldSpec(
                        "fallback_asset_set_ref",
                        ValueType.STRING,
                        reference=DefinitionReference.ASSET_SET,
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.COMPOSITE,
                implementation_id="targets.fallback_asset",
            ),
            PrimitiveSpec(
                id="portfolio_sleeve@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("local_targets", ValueType.PORTFOLIO_TARGETS),),
                outputs=(PortSpec("contribution", ValueType.PORTFOLIO_TARGETS),),
                fields=(
                    PrimitiveFieldSpec("name", ValueType.STRING),
                    PrimitiveFieldSpec(
                        "allocation",
                        ValueType.PERCENTAGE,
                        minimum=Decimal("0"),
                        maximum=Decimal("1"),
                        exclusive_minimum=True,
                    ),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.COMPOSITE,
                implementation_id="portfolio.sleeve",
            ),
            PrimitiveSpec(
                id="portfolio@1",
                category=PrimitiveCategory.TRANSFORM,
                inputs=(PortSpec("sleeves", ValueType.PORTFOLIO_TARGETS, multiple=True),),
                outputs=(targets_port,),
                fields=(PrimitiveFieldSpec("name", ValueType.STRING),),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.COMPOSITE,
                implementation_id="portfolio.compose",
            ),
            PrimitiveSpec(
                id="rebalance@1",
                category=PrimitiveCategory.EFFECT,
                inputs=(PortSpec("targets", ValueType.PORTFOLIO_TARGETS),),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="effect.rebalance",
            ),
            PrimitiveSpec(
                id="rule@1",
                category=PrimitiveCategory.RULE,
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="rule.condition_actions",
            ),
        )
    )


BUILTIN_REGISTRY = build_builtin_registry()
