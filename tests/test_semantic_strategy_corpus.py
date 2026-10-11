from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from ruletrade.strategy.v1.models import GroupDefinition, StrategyMetadata
from ruletrade.strategy.v2.corpus import (
    corpus_program,
    evaluate_corpus_entry,
    load_corpus,
    reference_snapshot,
    strongest_etfs_strategy,
)
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.models import (
    AssetSetDefinitionV2,
    CanonicalStrategyV2,
    NOfMConditionV2,
    StrategyDefinitionsV2,
)
from ruletrade.strategy.v2.projections import inspector_addresses, projection_bundle
from ruletrade.strategy.v2.semantic_types import Axis
from ruletrade.strategy.v2.validation import requirements_for_strategy, validate_strategy_v2
from ruletrade.strategy.v2.program_validation import validate_program_v2


CORPUS = Path(__file__).parents[1] / "corpus" / "semantic-strategy-corpus.json"
REFERENCE_FIXTURES = Path(__file__).parents[1] / "corpus" / "reference-evaluation-fixtures.json"


def _canonical(entry_id: str) -> CanonicalStrategyV2:
    manifest = load_corpus(CORPUS)
    entry = next(item for item in manifest.entries if item.id == entry_id)
    return CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name=entry.title),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinitionV2(id="growth-assets", assets=["A", "B", "C"]),),
            groups=(GroupDefinition(id="growth", name="Investment", asset_set_ref="growth-assets"),),
            asset_axis=Axis(name="asset", domain_id="growth"),
        ),
        operator_lock={"compare": "1", "daily.trailing_return": "1"},
        program=corpus_program(entry),
    )


def _decimal_map(value: dict[str, Decimal]) -> dict[str, str]:
    return {key: str(item) for key, item in sorted(value.items())}


def test_machine_readable_corpus_covers_families_and_keeps_capabilities_independent() -> None:
    manifest = load_corpus(CORPUS)
    assert len(manifest.entries) >= 30
    assert len({entry.family for entry in manifest.entries}) >= 15
    assert sum(entry.formalization_status == "formalized" for entry in manifest.entries) >= 8
    assert any(entry.capabilities.reference_evaluable and not entry.capabilities.backend_lowerable for entry in manifest.entries)
    assert any(entry.capabilities.backend_lowerable and not entry.capabilities.docker_verified for entry in manifest.entries)
    assert any(entry.capabilities.provider_supported and not entry.capabilities.ui_authorable for entry in manifest.entries)
    assert any(not entry.capabilities.provider_supported for entry in manifest.entries)
    assert all(entry.provenance.source_phrase for entry in manifest.entries)


def test_every_fully_formalized_case_has_deterministic_reference_behavior() -> None:
    manifest = load_corpus(CORPUS)
    for entry in manifest.entries:
        if entry.formalization_status != "formalized":
            continue
        cutoff = int(entry.expected_behavior["cutoff_index"])
        first = evaluate_corpus_entry(entry, cutoff_index=cutoff)
        second = evaluate_corpus_entry(entry, cutoff_index=cutoff)
        assert first == second
        expected = entry.expected_behavior
        if "selected" in expected:
            assert list(first.selection_outputs["selected-growth"]) == expected["selected"]
        if "targets" in expected:
            assert _decimal_map(first.target_weights) == expected["targets"]
        if "state" in expected:
            assert first.state == expected["state"]
        if "event_truths" in expected:
            assert first.event_truths == expected["event_truths"]
        if "remembered_values" in expected:
            assert _decimal_map(first.remembered_values) == expected["remembered_values"]


def test_reference_fixture_ledger_matches_runtime_decision_boundaries() -> None:
    manifest = load_corpus(CORPUS)
    fixture = json.loads(REFERENCE_FIXTURES.read_text(encoding="utf-8"))
    assert fixture["snapshot"]["id"] == reference_snapshot().snapshot_id
    expected_ids = {
        entry.id for entry in manifest.entries if entry.formalization_status == "formalized"
    }
    assert {item["corpus_id"] for item in fixture["fixtures"]} == expected_ids
    by_id = {item["corpus_id"]: item for item in fixture["fixtures"]}
    for entry_id, item in by_id.items():
        entry = next(entry for entry in manifest.entries if entry.id == entry_id)
        result = evaluate_corpus_entry(
            entry, cutoff_index=int(entry.expected_behavior["cutoff_index"]),
        )
        assert result.cutoff == item["cutoff"]
        if "selected" in item:
            assert list(result.selection_outputs["selected-growth"]) == item["selected"]
        if "targets" in item:
            assert _decimal_map(result.target_weights) == item["targets"]
        if "remembered_values" in item:
            assert _decimal_map(result.remembered_values) == item["remembered_values"]


def test_reference_results_are_domain_order_and_future_prefix_invariant() -> None:
    manifest = load_corpus(CORPUS)
    entry = next(item for item in manifest.entries if item.id == "strongest-etfs")
    original = reference_snapshot()
    reversed_domain = DailyMarketSnapshot(
        snapshot_id=original.snapshot_id,
        clock=original.clock,
        dates=original.dates,
        domains={"growth": tuple(reversed(original.domains["growth"]))},
        series=original.series,
    )
    expected = evaluate_corpus_entry(entry, original, cutoff_index=129)
    reordered = evaluate_corpus_entry(entry, reversed_domain, cutoff_index=129)
    assert reordered.selection_outputs == expected.selection_outputs
    assert reordered.target_weights == expected.target_weights

    prefix = DailyMarketSnapshot(
        snapshot_id="semantic-corpus-prefix",
        clock=original.clock,
        dates=original.dates[:5],
        domains=original.domains,
        series={symbol: {field: values[:5] for field, values in fields.items()} for symbol, fields in original.series.items()},
    )
    price_entry = next(item for item in manifest.entries if item.id == "price-over-sma")
    assert evaluate_corpus_entry(price_entry, prefix, cutoff_index=4).remembered_values == evaluate_corpus_entry(
        price_entry, original, cutoff_index=4,
    ).remembered_values


def test_projection_contracts_are_distinct_truthful_and_semantically_addressable() -> None:
    strategy = strongest_etfs_strategy()
    bundle = projection_bundle(strategy)
    assert set(bundle) == {"structure", "flow", "blocky", "rules", "summary"}
    assert all(manifest.semantic_valid for manifest in bundle.values())
    assert all(len({item.id for item in manifest.items}) == len(manifest.items) for manifest in bundle.values())
    assert {item.role for item in bundle["structure"].items} >= {
        "portfolio", "investment", "assets", "qualification", "selection", "fallback", "rebalance",
    }
    assert {item.role for item in bundle["flow"].items} >= {
        "portfolio", "investment", "selection", "destination", "fallback", "rebalance",
    }
    assert "assets" not in {item.role for item in bundle["blocky"].items}
    assert any(item.route == "fallback" for item in bundle["flow"].items)
    assert all("lowering" not in f"{item.label} {item.detail}".lower() for manifest in bundle.values() for item in manifest.items)
    inspector = inspector_addresses(strategy)
    selection = next(item for item in inspector.intents if item.address.semantic_id == "select-growth")
    assert "set_selection_ranking" in selection.valid_operations


def test_v2_executable_corpus_profile_reaches_the_strict_lean_plan() -> None:
    from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
    from ruletrade.compiler.lean import generate_csharp

    strategy = strongest_etfs_strategy()
    plan = compile_v2_strategy_to_lean_plan(strategy)
    assert plan.monthly_events
    assert plan.momentum_selections[0].lookback_bars == 126
    assert plan.momentum_selections[0].count == 2
    assert plan.target_sleeves[0].fallback_symbols == ("TLT",)
    assert '"filter_field", "condition"' in generate_csharp(plan)


def test_history_planning_accepts_n_of_m_and_state_conditions() -> None:
    strategy = _canonical("two-of-three-confirmation")
    assert not validate_strategy_v2(strategy)
    assert requirements_for_strategy(strategy).minimum_history_lower_bound == 1
    event = strategy.program.statements[0]
    assert isinstance(event.event.condition, NOfMConditionV2)


def test_cross_section_domain_conflicts_are_rejected_inside_eligibility() -> None:
    strategy = _canonical("candidate-over-group-median")
    statement = strategy.program.statements[0]
    eligibility = statement.selection.eligibility
    mismatched = eligibility.model_copy(update={
        "right": eligibility.right.model_copy(update={"domain_id": "another-domain"}),
    })
    changed = statement.model_copy(update={
        "selection": statement.selection.model_copy(update={"eligibility": mismatched}),
    })
    strategy = strategy.model_copy(update={
        "program": strategy.program.model_copy(update={
            "statements": (changed,) + strategy.program.statements[1:],
        }),
    })
    assert any(item.code == "cross_section_domain_mismatch" for item in validate_strategy_v2(strategy))


def test_one_semantic_id_cannot_alias_different_computation_content() -> None:
    program = corpus_program(next(
        item for item in load_corpus(CORPUS).entries if item.id == "price-over-sma"
    ))
    event = program.statements[0]
    remembered = event.statements[0]
    conflicting_value = remembered.value.model_copy(update={"subject_id": "B"})
    changed_event = event.model_copy(update={
        "statements": (remembered.model_copy(update={"value": conflicting_value}),),
    })
    changed = program.model_copy(update={"statements": (changed_event,)})
    assert any(item.code == "semantic_id_content_conflict" for item in validate_program_v2(changed))


@pytest.mark.parametrize("entry_id", ["strong-breakout", "low-risk-assets", "reasonable-turnover"])
def test_ambiguous_prose_never_receives_a_hidden_program(entry_id: str) -> None:
    entry = next(item for item in load_corpus(CORPUS).entries if item.id == entry_id)
    assert entry.formalization_status == "ambiguous"
    assert entry.fixture is None
    assert not entry.capabilities.representable
