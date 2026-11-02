from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_case_matrix_is_complete_traceable_and_conservative() -> None:
    matrix = json.loads((ROOT / "corpus/blocky-169-case-matrix.json").read_text())
    cases = matrix["cases"]
    assert matrix["source_case_count"] == 169
    assert len(cases) == 169
    assert len({case["case_id"] for case in cases}) == 169
    assert all(case["original_fragment"] for case in cases)
    assert all(case["normalized_interpretation"] for case in cases)
    assert all(case["previous_review_hypothesis"] is not None for case in cases)
    assert all(case["primary_classification"] in {"A", "B", "C", "D", "E"} for case in cases)
    # Corpus fragments are not silently promoted to executable strategies.
    assert not any(case["current_implementation_support"]["runtime_executable"] for case in cases)
    assert not any(case["current_implementation_support"]["docker_verified"] for case in cases)


def test_published_coverage_is_recomputable_from_case_level_matrix() -> None:
    matrix = json.loads((ROOT / "corpus/blocky-169-case-matrix.json").read_text())["cases"]
    coverage = json.loads((ROOT / "corpus/blocky-feature-coverage.json").read_text())
    assert coverage["denominator"] == 169
    assert coverage["primary_classification_counts"] == dict(sorted(Counter(case["primary_classification"] for case in matrix).items()))
    assert coverage["current_proven_coverage"] == sum(
        case["primary_classification"] == "A" and case["current_implementation_support"]["semantically_representable"]
        for case in matrix
    )
    assert coverage["p0_draftable_cases"] == sum(
        case["possible_blocky_composition"]["uses_new_p0_registered_blocks"] for case in matrix
    )
    assert coverage["post_implementation_proven_execution"] == 0


def test_composition_fixture_covers_the_fifteen_requested_multi_fragment_journeys() -> None:
    fixtures = json.loads((ROOT / "corpus/blocky-composition-fixtures.json").read_text())
    journeys = fixtures["acceptance_compositions"]
    assert len(journeys) == 15
    assert len({journey["id"] for journey in journeys}) == 15
    assert all(journey["blocks"] and journey["execution"] for journey in journeys)
    assert next(journey for journey in journeys if journey["id"] == "options-wheel-audit")["status"] == "representation_audit"
