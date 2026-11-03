#!/usr/bin/env python3
"""Build the strategy source manifest and conservative perspective specification.

The natural-language corpus contains fragments.  This generator deliberately keeps
those records distinct from formalized SemanticProgramV2 examples and never upgrades
projection evidence into authoring or execution evidence.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus"
DOCS = ROOT / "docs" / "corpus"

GENERATED = {
    "strategy-source-manifest.json",
    "unified-strategy-corpus.json",
    "strategy-perspective-matrix.json",
    "perspective-authoring-journeys.json",
    "perspective-conflict-cases.json",
    "grammar-coverage-matrix.json",
    "perspective-translation-contracts.json",
    "coverage-and-gap-analysis.json",
    "representative-ui-serialization-fixtures.json",
    "authoring-execution-evidence.json",
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def json_rows(path: Path, payload: Any) -> tuple[str | None, list[Any]]:
    if isinstance(payload, list):
        return None, payload
    for key in ("cases", "entries", "journeys", "fixtures", "records", "strategies"):
        if isinstance(payload.get(key), list):
            return key, payload[key]
    return None, []


def source_manifest() -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    for path in sorted(CORPUS.iterdir()):
        if path.name in GENERATED or path.suffix not in {".json", ".jsonl"}:
            continue
        if path.suffix == ".jsonl":
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
            container = "jsonl"
        else:
            payload = load_json(path)
            key, rows = json_rows(path, payload)
            container = key or "object"
        authority = "supporting_evidence"
        item_type = "supporting_record"
        caveats: list[str] = []
        if path.name == "blocky-169-source.jsonl":
            authority = "original_fragment_source"
            item_type = "fragment"
            caveats.append("Natural-language fragments are not complete executable strategies.")
        elif path.name == "semantic-strategy-corpus.json":
            authority = "formalized_semantic_corpus"
            item_type = "complete_strategy_or_execution_fixture"
        elif "roundtrip" in path.name or "acceptance" in path.name:
            authority = "authoring_or_roundtrip_evidence"
            item_type = "authoring_journey"
        elif "matrix" in path.name or "coverage" in path.name:
            authority = "derived_analysis"
            item_type = "analysis_record"
        sources.append({
            "source_id": f"source:{path.stem}",
            "path": path.relative_to(ROOT).as_posix(),
            "format": path.suffix.lstrip("."),
            "container": container,
            "record_count": len(rows),
            "authority": authority,
            "item_type": item_type,
            "caveats": caveats,
        })
    return {
        "schema": "ruletrade.strategy-source-manifest.v1",
        "audited_baseline": "main@95158dd63a005a6c4db8c60d57f91b9c0a2c90e0",
        "sources": sources,
        "invariants": [
            "Original natural-language records remain fragments.",
            "Derived records retain source IDs and do not replace their sources.",
            "Projection, authoring, lowering, and Docker evidence are separate claims.",
        ],
    }


def fragment_item(case: dict[str, Any]) -> dict[str, Any]:
    source = case["source"]
    return {
        "id": f"fragment:{case['case_id']}",
        "item_type": "fragment",
        "title": case["case_id"],
        "provenance": {
            "source_id": "source:blocky-169-source",
            "source_record_id": case["case_id"],
            "source_location": f"corpus/blocky-169-source.jsonl#{case['case_id']}",
            "original_wording": case["original_fragment"],
            "original_context": source,
            "original_classification": case.get("previous_review_hypothesis"),
            "reconstructed": False,
        },
        "interpretation": case["normalized_interpretation"],
        "ambiguities": case["ambiguity"],
        "assumptions": case["possible_blocky_composition"]["semantic_assumptions"],
        "required_parameters": case["possible_blocky_composition"]["unresolved_inputs"],
        "semantic_specification": {
            "feature_ids": case["original_required_primitives"],
            "evaluation_context": case["required_evaluation_context"],
            "dependencies": case["dependencies"],
            "external_data": case["required_external_data"],
            "missing_primitives": case["missing_primitives"],
        },
        "canonical_reference": None,
        "capabilities": case["current_implementation_support"],
        "relations": {"derived_complete_strategies": []},
    }


def semantic_item(entry: dict[str, Any]) -> dict[str, Any]:
    capabilities = dict(entry.get("capabilities", {}))
    fixture = entry.get("fixture")
    formal = entry.get("formalization_status") == "formalized"
    return {
        "id": f"strategy:{entry['id']}",
        "item_type": "execution_fixture" if capabilities.get("docker_verified") else "complete_strategy",
        "title": entry.get("title", entry["id"]),
        "provenance": {
            "source_id": "source:semantic-strategy-corpus",
            "source_record_id": entry["id"],
            "source_location": f"corpus/semantic-strategy-corpus.json#{entry['id']}",
            "original_wording": entry.get("provenance", {}).get("source_phrase"),
            "original_context": entry.get("provenance", {}),
            "original_classification": entry.get("family"),
            "reconstructed": False,
        },
        "interpretation": entry.get("provenance", {}).get("interpretation"),
        "ambiguities": [] if formal else ["semantic formalization is incomplete"],
        "assumptions": [],
        "required_parameters": [],
        "semantic_specification": {
            "feature_ids": [entry.get("family")],
            "dependencies": entry.get("dependencies", []),
            "expected_behavior": entry.get("expected_behavior"),
        },
        "canonical_reference": ({"fixture": fixture, "validated": True} if formal and fixture else None),
        "capabilities": capabilities,
        "relations": {"source_fragments": []},
    }


def unified_corpus() -> dict[str, Any]:
    fragment_payload = load_json(CORPUS / "blocky-169-case-matrix.json")
    semantic_payload = load_json(CORPUS / "semantic-strategy-corpus.json")
    items = [fragment_item(case) for case in fragment_payload["cases"]]
    items.extend(semantic_item(entry) for entry in semantic_payload["entries"])
    counts = Counter(item["item_type"] for item in items)
    patterns = {
        feature
        for item in items
        for feature in item["semantic_specification"].get("feature_ids", [])
        if feature
    }
    return {
        "schema": "ruletrade.unified-strategy-corpus.v1",
        "items": items,
        "statistics": {
            "total_items": len(items),
            "original_fragments": counts["fragment"],
            "complete_strategies": counts["complete_strategy"],
            "execution_fixtures": counts["execution_fixture"],
            "unique_semantic_patterns": len(patterns),
        },
    }


def perspective_cell(item: dict[str, Any], perspective: str) -> dict[str, Any]:
    caps = item["capabilities"]
    fragment = item["item_type"] == "fragment"
    ui_authorable = bool(caps.get("ui_authorable")) and not fragment
    representable = bool(caps.get("semantically_representable", caps.get("representable")))
    if perspective in {"summary", "code"} and representable:
        status = "exact_read_only"
    elif ui_authorable:
        status = "unverified"
    elif fragment:
        status = "draft_only" if caps.get("visually_draftable") else "unsupported"
    else:
        status = "unverified"
    return {
        "status": status,
        "contract_ref": f"perspective:{perspective}",
        "reverse_translation": "unverified" if not ui_authorable else "evidence required",
    }


def perspective_matrix(corpus: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for item in corpus["items"]:
        rows.append({
            "case_id": item["id"],
            "item_type": item["item_type"],
            "semantic": {
                "corpus_ref": item["id"],
                "canonical_reference": item["canonical_reference"],
            },
            "perspectives": {
                name: perspective_cell(item, name)
                for name in ("guide", "flow", "blocky", "rules", "summary", "code")
            },
        })
    roles = {
        "guide": "guided composition",
        "flow": "capital routing",
        "blocky": "logical execution and dependency flow",
        "rules": "declarative strategy meaning",
        "summary": "human-readable committed meaning",
        "code": "precise canonical semantics",
    }
    return {
        "schema": "ruletrade.strategy-perspective-matrix.v1",
        "perspectives": ["guide", "flow", "blocky", "rules", "summary", "code"],
        "perspective_contracts": {
            f"perspective:{name}": {
                "role": role,
                "draft_behavior": "perspective-local; never an independent canonical authority",
                "commit_boundary": "verified typed operation and CAS",
                "reprojection": "from committed or shared working semantic state",
            }
            for name, role in roles.items()
        },
        "cross_cutting_surfaces": {
            "structure": "ownership and dependency navigation",
            "objects": "stable reusable definitions and references",
            "inspector": "advanced configuration, selection, and diagnostics",
        },
        "evidence_boundaries": [
            "Projection is not proof of authorability.",
            "Draftability is not proof of execution support.",
        ],
        "rows": rows,
    }


def source_inventory_doc(manifest: dict[str, Any]) -> str:
    lines = ["# Strategy source inventory", "", "Generated by `scripts/build_strategy_perspective_corpus.py`.", "", "| Source | Records | Authority | Item type |", "|---|---:|---|---|"]
    for source in manifest["sources"]:
        lines.append(f"| `{source['path']}` | {source['record_count']} | {source['authority']} | {source['item_type']} |")
    lines += ["", "## Provenance boundary", "", "The 169 natural-language records are fragments. They are never counted as complete or executable strategies. Formalized semantic fixtures remain separate records and retain their own evidence boundaries.", ""]
    return "\n".join(lines)


def corpus_index_doc(corpus: dict[str, Any]) -> str:
    s = corpus["statistics"]
    return f"""# Unified strategy corpus index

Generated by `scripts/build_strategy_perspective_corpus.py`.

| Measure | Count |
|---|---:|
| Total records | {s['total_items']} |
| Original fragments | {s['original_fragments']} |
| Complete strategies | {s['complete_strategies']} |
| Docker-verified execution fixtures | {s['execution_fixtures']} |
| Unique semantic pattern labels | {s['unique_semantic_patterns']} |

Fragments, complete strategies, and execution fixtures use different item types. Counts are not interchangeable.
"""


def matrix_doc(matrix: dict[str, Any]) -> str:
    counts = Counter(
        cell["status"]
        for row in matrix["rows"]
        for cell in row["perspectives"].values()
    )
    lines = ["# Strategy × Perspective matrix", "", "This document is generated from `corpus/strategy-perspective-matrix.json`.", "", f"Rows: **{len(matrix['rows'])}**; perspectives per row: **6**.", "", "| Cell status | Count |", "|---|---:|"]
    lines.extend(f"| {key} | {value} |" for key, value in sorted(counts.items()))
    lines += ["", "A projection does not establish authorability. Draft-only support does not establish semantic or runtime support.", ""]
    return "\n".join(lines)


def build() -> dict[Path, str]:
    manifest = source_manifest()
    corpus = unified_corpus()
    matrix = perspective_matrix(corpus)
    values = {
        CORPUS / "strategy-source-manifest.json": json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        CORPUS / "unified-strategy-corpus.json": json.dumps(corpus, ensure_ascii=False, separators=(",", ":")) + "\n",
        CORPUS / "strategy-perspective-matrix.json": json.dumps(matrix, ensure_ascii=False, separators=(",", ":")) + "\n",
        DOCS / "source-inventory.md": source_inventory_doc(manifest),
        DOCS / "strategy-corpus-index.md": corpus_index_doc(corpus),
        DOCS / "strategy-perspective-matrix.md": matrix_doc(matrix),
    }
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    values = build()
    if args.check:
        stale = [path.relative_to(ROOT).as_posix() for path, value in values.items() if not path.exists() or path.read_text(encoding="utf-8") != value]
        if stale:
            raise SystemExit("generated corpus artifacts are stale: " + ", ".join(stale))
        return
    for path, value in values.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")


if __name__ == "__main__":
    main()
