from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from ruletrade.strategy.v1.types import ValueType


class PrimitiveCategory(StrEnum):
    EVENT = "event"
    TRANSFORM = "transform"
    RULE = "rule"
    ALLOCATOR = "allocator"
    EFFECT = "effect"


class BackendCapability(StrEnum):
    NATIVE = "native"
    FRAMEWORK = "framework"
    GENERATED = "generated"
    COMPOSITE = "composite"


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


class PrimitiveRegistry:
    def __init__(self, primitives: tuple[PrimitiveSpec, ...] = ()) -> None:
        self._primitives: dict[str, PrimitiveSpec] = {}
        for primitive in primitives:
            self.register(primitive)

    def register(self, primitive: PrimitiveSpec) -> None:
        if primitive.id in self._primitives:
            raise ValueError(f"primitive already registered: {primitive.id}")
        self._primitives[primitive.id] = primitive

    def get(self, primitive_id: str) -> PrimitiveSpec:
        try:
            return self._primitives[primitive_id]
        except KeyError as exc:
            raise KeyError(f"unknown primitive: {primitive_id}") from exc

    def all(self) -> tuple[PrimitiveSpec, ...]:
        return tuple(self._primitives[key] for key in sorted(self._primitives))


COMMON_VIEWS = frozenset({"guided", "rules", "flow", "blocks", "code"})


def build_builtin_registry() -> PrimitiveRegistry:
    asset_set_port = PortSpec("assets", ValueType.ASSET_SET)
    targets_port = PortSpec("targets", ValueType.PORTFOLIO_TARGETS)

    return PrimitiveRegistry(
        (
            PrimitiveSpec(
                id="monthly@1",
                category=PrimitiveCategory.EVENT,
                fields=(PrimitiveFieldSpec("day", ValueType.INTEGER, required=False, default=1),),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.NATIVE,
                implementation_id="event.monthly",
            ),
            PrimitiveSpec(
                id="asset_set@1",
                category=PrimitiveCategory.TRANSFORM,
                outputs=(asset_set_port,),
                fields=(PrimitiveFieldSpec("asset_set_ref", ValueType.STRING),),
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
                    PrimitiveFieldSpec("count", ValueType.INTEGER),
                    PrimitiveFieldSpec("resample", ValueType.STRING, required=False, default="per_event"),
                ),
                authoring_views=COMMON_VIEWS,
                backend_capability=BackendCapability.GENERATED,
                implementation_id="selection.random_n_v1",
            ),
            PrimitiveSpec(
                id="equal_weight@1",
                category=PrimitiveCategory.ALLOCATOR,
                inputs=(PortSpec("assets", ValueType.ASSET_SET),),
                outputs=(targets_port,),
                fields=(PrimitiveFieldSpec("total", ValueType.PERCENTAGE),),
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
