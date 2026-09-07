from decimal import Decimal

import pytest

from ruletrade.strategy.v1.registry import (
    BackendCapability,
    BUILTIN_REGISTRY,
    PrimitiveCategory,
    PrimitiveFieldSpec,
    PrimitiveRegistry,
    PrimitiveSpec,
)
from ruletrade.strategy.v1.types import ValueType


def test_builtin_registry_exposes_versioned_primitives() -> None:
    random_select = BUILTIN_REGISTRY.get("random_select@1")

    assert random_select.category == PrimitiveCategory.TRANSFORM
    assert random_select.inputs[0].value_type == ValueType.ASSET_SET
    assert random_select.implementation_id == "selection.random_n_v1"


def test_registry_rejects_duplicate_primitive_ids() -> None:
    primitive = PrimitiveSpec(id="example@1", category=PrimitiveCategory.TRANSFORM)
    registry = PrimitiveRegistry((primitive,))

    with pytest.raises(ValueError, match="already registered"):
        registry.register(primitive)


def test_registry_lists_primitives_deterministically() -> None:
    ids = [primitive.id for primitive in BUILTIN_REGISTRY.all()]

    assert ids == sorted(ids)


def test_indicator_registry_entry_declares_parameters_and_result_type() -> None:
    indicator = PrimitiveSpec(
        id="sma@1",
        category=PrimitiveCategory.INDICATOR,
        fields=(
            PrimitiveFieldSpec(
                "period",
                ValueType.INTEGER,
                minimum=Decimal("2"),
            ),
        ),
        result_type=ValueType.MONEY_PER_SHARE,
        backend_capability=BackendCapability.NATIVE,
        implementation_id="indicator.sma",
    )
    registry = PrimitiveRegistry((indicator,))

    assert registry.get("sma@1").result_type == ValueType.MONEY_PER_SHARE


def test_indicator_registry_entry_requires_result_type() -> None:
    with pytest.raises(ValueError, match="require a result type"):
        PrimitiveRegistry(
            (PrimitiveSpec(id="broken@1", category=PrimitiveCategory.INDICATOR),)
        )
