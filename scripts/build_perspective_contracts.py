#!/usr/bin/env python3
"""Derive authoring, reconciliation, translation, grammar, and coverage contracts."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus"
ARCH = ROOT / "docs" / "architecture"
DOCS = ROOT / "docs" / "corpus"


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def journeys() -> dict[str, Any]:
    intents = load(CORPUS / "intent-authoring-user-actions.json")
    acceptance = load(CORPUS / "entry-style-builder-acceptance.json")
    rows = []
    for item in intents["journeys"]:
        steps = []
        for index, step in enumerate(item["steps"]):
            commit = step.get("commit")
            steps.append({
                "sequence": index + 1,
                "initial_or_prior_state": "perspective draft" if index else "committed semantic state plus empty local draft",
                "perspective": step["view"],
                "gesture": step["action"],
                "draft_mutation": step.get("draft_object"),
                "semantic_intent": item["strategy"],
                "required_context": step.get("unresolved", []),
                "validation_outcome": step.get("capability"),
                "canonical_operation": commit,
                "semantic_state": "shared working semantic state" if commit else "local incomplete draft",
                "other_perspective_projection": "after validated operation only" if commit else "none",
                "persistence": "explicit Save/CAS required" if commit else "working draft only",
            })
        rows.append({
            "journey_id": item["id"],
            "strategy": item["strategy"],
            "construction_order": item["start_path"],
            "evidence": "production intent authoring contract",
            "steps": steps,
        })
    existing = {row["journey_id"] for row in rows}
    for item in acceptance["journeys"]:
        identity = f"acceptance:{item['id']}"
        if identity in existing:
            continue
        rows.append({
            "journey_id": identity,
            "strategy": item["visual"],
            "construction_order": "visual_composition",
            "evidence": item.get("evidence"),
            "steps": [{
                "sequence": 1,
                "initial_or_prior_state": "blank Working Draft v3",
                "perspective": "Blocky",
                "gesture": item["visual"],
                "draft_mutation": {"connections": item.get("connections", []), "active_roots": item.get("active_roots", [])},
                "semantic_intent": item.get("semantic"),
                "required_context": [],
                "validation_outcome": item.get("capability"),
                "canonical_operation": None,
                "semantic_state": "fixture does not prove a canonical commit",
                "other_perspective_projection": "unverified",
                "persistence": "draft fixture evidence only",
            }],
        })
    return {"schema": "ruletrade.perspective-authoring-journeys.v1", "journeys": rows}


def conflicts() -> dict[str, Any]:
    cases = [
        ("layout-only", "no_semantic_change", "preserve both layouts", False),
        ("incomplete-flow-route", "incomplete_draft", "retain Flow draft; do not project", False),
        ("stale-blocky-base", "stale_draft", "require rebase or explicit discard", True),
        ("independent-addresses", "compatible_semantic_change", "merge typed operations after dependency check", False),
        ("same-allocation-address", "direct_conflict", "preserve both drafts and require explicit choice", True),
        ("group-removed-while-referenced", "dependency_conflict", "block commit until reference is resolved", True),
        ("unsupported-flow-projection", "unsupported_translation", "preserve canonical meaning; render capability boundary", False),
        ("fixed-money-versus-target-weight", "direct_conflict", "never coerce order notional into rebalance weight", True),
    ]
    return {
        "schema": "ruletrade.perspective-conflict-cases.v1",
        "cases": [
            {
                "id": identity,
                "classification": classification,
                "resolution": resolution,
                "user_resolution_required": required,
                "canonical_mutation": "none until validated resolution" if required else "typed operation only when semantic meaning changes",
                "draft_preservation": "all perspective drafts retained",
            }
            for identity, classification, resolution, required in cases
        ],
    }


def grammar() -> dict[str, Any]:
    matrix = load(CORPUS / "blocky-169-case-matrix.json")
    counts = Counter(
        primitive
        for case in matrix["cases"]
        for primitive in case.get("missing_primitives", [])
    )
    existing = load(ROOT / "docs" / "architecture" / "perspective-capability-matrix.json")
    primitives = []
    for primitive, count in counts.most_common():
        primitives.append({
            "primitive": primitive,
            "fragment_cases": count,
            "semantic_expressiveness": "candidate",
            "engine_support": "unverified",
            "perspective_reuse": ["Blocky", "Rules", "Inspector"],
            "implementation_status": "gap",
        })
    return {
        "schema": "ruletrade.grammar-coverage-matrix.v1",
        "denominator": 169,
        "perspective_roles": existing["perspectives"],
        "primitives": primitives,
    }


def translations() -> dict[str, Any]:
    source = load(CORPUS / "perspective-translation-corpus.json")
    operations = load(ROOT / "docs" / "architecture" / "semantic-operation-registry.json")
    known = set(operations["canonical_operations"])
    rows = []
    for case in source["cases"]:
        authorable = bool(case.get("ui_authorable"))
        operation = None
        if authorable:
            operation = {
                "single-asset-holding": "commit_single_asset_intent",
                "strongest-etfs": "set_program_selection",
                "growth-defensive": "commit_split_portfolio_intent",
            }.get(case["id"])
        if operation not in known:
            operation = None
        rows.append({
            "contract_id": case["id"],
            "source_case": case["source_case"],
            "canonical_reference": case.get("repository_fixture"),
            "forward": {
                "source": "CanonicalStrategyV2",
                "semantic_manifest": case["formalization"],
                "projection_identity": case.get("repository_fixture") or case["id"],
                "preserved_fields": "all fields represented by the target capability manifest",
                "hidden_fields": "must remain in canonical meaning",
                "status": "supported" if case.get("representable") else "unsupported",
            },
            "reverse": {
                "gesture": "documented production authoring journey" if authorable else None,
                "draft_mutation": "perspective-local",
                "typed_operation": operation,
                "validation": "V2 validation plus CAS",
                "atomicity": "single typed operation",
                "status": "supported_verified" if operation else "unverified_or_unsupported",
            },
            "capability": {
                key: case.get(key)
                for key in ("representable", "reference_evaluable", "backend_lowerable", "docker_verified", "provider_supported", "ui_authorable")
            },
        })
    return {
        "schema": "ruletrade.perspective-translation-contracts.v1",
        "contracts": rows,
        "counterexamples": source.get("counterexamples", []),
    }


def coverage() -> dict[str, Any]:
    matrix = load(CORPUS / "blocky-169-case-matrix.json")
    cases = matrix["cases"]
    dimensions = [
        "visually_draftable", "typed_graph_valid", "semantically_representable",
        "reference_evaluable", "backend_lowerable", "docker_verified",
        "provider_supported", "ui_authorable", "runtime_executable",
    ]
    counts = {key: sum(case["current_implementation_support"].get(key) is True for case in cases) for key in dimensions}
    blockers = Counter(blocker for case in cases for blocker in case["secondary_blockers"])
    return {
        "schema": "ruletrade.coverage-and-gap-analysis.v1",
        "denominator": 169,
        "coverage": {key: {"proven": value, "denominator": 169} for key, value in counts.items()},
        "gap_counts": dict(sorted(blockers.items())),
        "rules": [
            "Draft-only support is not execution support.",
            "Projection is not authoring evidence.",
            "Canonical fixtures are not UI authorability evidence.",
            "A case with multiple blockers is counted once per independent blocker.",
        ],
    }


def docs(values: dict[str, Any]) -> dict[Path, str]:
    grammar_value = values["grammar"]
    top = grammar_value["primitives"][:20]
    grammar_lines = ["# Derived semantic grammar", "", "Derived from the 169-fragment matrix; occurrence counts are not execution claims.", "", "| Primitive gap | Fragment occurrences |", "|---|---:|"]
    grammar_lines.extend(f"| `{row['primitive']}` | {row['fragment_cases']} |" for row in top)
    perspective_lines = ["# Perspective grammar specifications", "", "| Perspective | Product role |", "|---|---|"]
    for name, spec in grammar_value["perspective_roles"].items():
        perspective_lines.append(f"| {name} | {spec['role']} |")
    translation = values["translation"]
    translation_lines = ["# Perspective translation contracts", "", "Forward projection and reverse authoring are independent capability claims.", "", "| Contract | Forward | Reverse |", "|---|---|---|"]
    for row in translation["contracts"]:
        translation_lines.append(f"| `{row['contract_id']}` | {row['forward']['status']} | {row['reverse']['status']} |")
    coverage_value = values["coverage"]
    coverage_lines = ["# Coverage and gap analysis", "", "Denominator: **169 original fragments**.", "", "| Dimension | Proven |", "|---|---:|"]
    coverage_lines.extend(f"| {key} | {item['proven']} / 169 |" for key, item in coverage_value["coverage"].items())
    reconciliation = """# Perspective draft reconciliation

Each editable perspective owns its unfinished draft. The shared working semantic state is distinct from both drafts and persisted immutable revisions.

`Perspective draft → completed intent → validation → shared working state → projection → explicit Save/CAS → immutable revision`

Layout-only changes remain local. Compatible changes at independent semantic addresses may reconcile after dependency checks. Stale, direct, and dependency conflicts preserve all drafts and require explicit resolution. Perspective switching never saves a revision, and Test always performs strict preflight against an identified working state or revision.
"""
    return {
        ARCH / "perspective-draft-reconciliation.md": reconciliation,
        ARCH / "derived-semantic-grammar.md": "\n".join(grammar_lines) + "\n",
        ARCH / "perspective-grammar-specifications.md": "\n".join(perspective_lines) + "\n",
        ARCH / "perspective-translation-contracts.md": "\n".join(translation_lines) + "\n",
        DOCS / "coverage-and-gap-analysis.md": "\n".join(coverage_lines) + "\n",
    }


def build() -> dict[Path, str]:
    values = {
        "journeys": journeys(),
        "conflicts": conflicts(),
        "grammar": grammar(),
        "translation": translations(),
        "coverage": coverage(),
    }
    paths = {
        CORPUS / "perspective-authoring-journeys.json": values["journeys"],
        CORPUS / "perspective-conflict-cases.json": values["conflicts"],
        CORPUS / "grammar-coverage-matrix.json": values["grammar"],
        CORPUS / "perspective-translation-contracts.json": values["translation"],
        CORPUS / "coverage-and-gap-analysis.json": values["coverage"],
    }
    rendered = {path: json.dumps(value, indent=2, ensure_ascii=False) + "\n" for path, value in paths.items()}
    rendered.update(docs(values))
    return rendered


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    values = build()
    if args.check:
        stale = [path.relative_to(ROOT).as_posix() for path, value in values.items() if not path.exists() or path.read_text(encoding="utf-8") != value]
        if stale:
            raise SystemExit("generated perspective contracts are stale: " + ", ".join(stale))
        return
    for path, value in values.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")


if __name__ == "__main__":
    main()
