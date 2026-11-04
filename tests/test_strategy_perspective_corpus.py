from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(name: str) -> dict:
    return json.loads((ROOT / "corpus" / name).read_text(encoding="utf-8"))


def test_original_fragments_keep_identity_and_provenance() -> None:
    corpus = load("unified-strategy-corpus.json")
    fragments = [item for item in corpus["items"] if item["item_type"] == "fragment"]
    assert len(fragments) == 169
    assert len({item["id"] for item in fragments}) == 169
    assert all(item["canonical_reference"] is None for item in fragments)
    assert all(item["provenance"]["original_wording"] for item in fragments)
    assert all(not item["provenance"]["reconstructed"] for item in fragments)


def test_matrix_has_structured_semantic_and_six_perspectives_per_case() -> None:
    corpus = load("unified-strategy-corpus.json")
    matrix = load("strategy-perspective-matrix.json")
    assert len(matrix["rows"]) == len(corpus["items"])
    assert {row["case_id"] for row in matrix["rows"]} == {
        item["id"] for item in corpus["items"]
    }
    expected = {"guide", "flow", "blocky", "rules", "summary", "code"}
    for row in matrix["rows"]:
        assert set(row["perspectives"]) == expected
        assert isinstance(row["semantic"], dict)
        assert all(isinstance(cell, dict) for cell in row["perspectives"].values())


def test_generated_artifacts_are_current() -> None:
    subprocess.run(
        [sys.executable, "scripts/build_strategy_perspective_corpus.py", "--check"],
        cwd=ROOT,
        check=True,
    )
