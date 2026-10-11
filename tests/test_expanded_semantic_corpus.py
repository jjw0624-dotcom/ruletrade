from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from ruletrade.strategy.v2.corpus import (
    reference_snapshot,
    weighted_momentum_allocation_program,
)
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.program_execution import execute_program_v2


MATRIX = Path(__file__).parents[1] / "corpus" / "expanded-semantic-case-matrix.json"


def _matrix() -> dict[str, object]:
    return json.loads(MATRIX.read_text(encoding="utf-8"))


def test_expanded_matrix_reconciles_every_source_case_without_count_inflation() -> None:
    matrix = _matrix()
    summary = matrix["summary"]
    cases = matrix["cases"]
    assert summary["raw_cases"] == 169 == len(cases)
    assert summary["source_groups"] == 61
    assert summary["deduplicated_semantic_families"] == 21
    assert summary["case_kind_counts"] == {
        "strategy_fragment": 169,
        "complete_strategy": 0,
    }
    assert len({case["case_id"] for case in cases}) == 169
    assert all(case["audit"]["case_kind"] == "strategy_fragment" for case in cases)


def test_expanded_matrix_keeps_provenance_ambiguity_and_capabilities_independent() -> None:
    cases = _matrix()["cases"]
    statuses = {"PASS", "FAIL", "NOT_PROVEN", "UNSUPPORTED"}
    assert sum(case["audit"]["status"] == "ambiguous" for case in cases) == 96
    assert all(case["source"]["url"] for case in cases)
    assert all(case["source_paraphrase"] for case in cases)
    assert all(case["dataset_interpretation"] for case in cases)
    assert all(
        set(case["audit"]["capabilities"].values()) <= statuses
        for case in cases
    )
    assert any(
        case["audit"]["capabilities"]["provider_supported"] == "PASS"
        and case["audit"]["capabilities"]["backend_lowerable"] == "NOT_PROVEN"
        for case in cases
    )
    assert all(
        case["audit"]["capabilities"]["docker_verified"] != "PASS"
        for case in cases
    )


def test_expanded_score_cases_link_to_abstraction_without_claiming_case_execution() -> None:
    cases = {case["case_id"]: case for case in _matrix()["cases"]}
    for case_id in ("NL038", "NL112", "NL133", "NL143", "NL157"):
        case = cases[case_id]
        overlaps = case["audit"]["existing_corpus_overlap"]
        assert any(
            value in overlaps
            for value in ("composite-factor-rerank", "weighted-momentum-score-allocation")
        )
        assert case["audit"]["execution_claim"].startswith("No complete-strategy")
        assert case["audit"]["capabilities"]["docker_verified"] != "PASS"


def test_weighted_score_insufficient_history_retains_without_fabricating_targets() -> None:
    result = execute_program_v2(
        weighted_momentum_allocation_program(), reference_snapshot(), cutoff_index=0,
    )
    assert result.selection_outputs["selected-growth"] == ()
    assert result.target_weights == {}
    assert result.retained_holdings
    assert any(
        item.kind == "allocation" and item.outcome == "unresolved_retain"
        for item in result.evidence
    )


def test_weighted_score_cutoff_is_future_prefix_invariant() -> None:
    snapshot = reference_snapshot()
    cutoff = 4
    prefix = DailyMarketSnapshot(
        snapshot_id="weighted-score-prefix",
        clock=snapshot.clock,
        dates=snapshot.dates[: cutoff + 1],
        domains=snapshot.domains,
        series={
            symbol: {
                field: values[: cutoff + 1]
                for field, values in fields.items()
            }
            for symbol, fields in snapshot.series.items()
        },
    )
    program = weighted_momentum_allocation_program()
    full = execute_program_v2(program, snapshot, cutoff_index=cutoff)
    truncated = execute_program_v2(program, prefix, cutoff_index=cutoff)
    assert truncated.selection_scores == full.selection_scores
    assert truncated.target_weights == full.target_weights
    assert sum(truncated.target_weights.values(), Decimal(0)) == Decimal(1)
