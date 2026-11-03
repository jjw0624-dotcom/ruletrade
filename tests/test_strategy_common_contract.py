from __future__ import annotations

from ruletrade.strategy.common import GroupDefinition, StrategyMetadata
from ruletrade.strategy.v1.models import (
    GroupDefinition as LegacyGroupDefinition,
    StrategyMetadata as LegacyStrategyMetadata,
)
from ruletrade.strategy.v2.authoring import ProgramStrategyTemplateRequest, create_program_strategy_template


def test_v1_reexports_neutral_value_objects_without_schema_change() -> None:
    assert LegacyGroupDefinition is GroupDefinition
    assert LegacyStrategyMetadata is StrategyMetadata
    metadata = StrategyMetadata(name="Example", description="Stable", tags=("one",))
    group = GroupDefinition(id="growth", name="Growth", asset_set_ref="growth-assets")
    assert metadata.model_dump(mode="json") == {
        "name": "Example", "description": "Stable", "tags": ["one"],
    }
    assert group.model_dump(mode="json") == {
        "id": "growth", "name": "Growth", "asset_set_ref": "growth-assets", "description": "",
    }


def test_new_v2_authoring_uses_neutral_metadata() -> None:
    strategy = create_program_strategy_template(ProgramStrategyTemplateRequest(name="V2 native"))
    assert type(strategy.metadata) is StrategyMetadata
    assert strategy.metadata.name == "V2 native"
