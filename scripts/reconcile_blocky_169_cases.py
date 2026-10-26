#!/usr/bin/env python3
"""Reconcile the RuleTrade natural-language fragment corpus without inventing strategy inputs.

The source records are fragments, not executable strategies.  This script turns every
source row into a traceable review record, proposed typed composition, and conservative
coverage summary.  It deliberately marks a missing clock, universe, threshold, provider,
or policy as unresolved instead of filling it with a product default.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


CURRENT_BLOCKS = {
    "start-daily", "start-monthly", "if-otherwise", "compare-gt", "compare-lt",
    "compare-eq", "logic-and", "logic-or", "logic-not", "asset-value",
    "trailing-return", "sma", "weighted-score", "invest", "rebalance",
    "group-reference", "subgroup-reference", "choose-group", "remember-value", "state",
}
P0_BLOCKS = {
    "filter-assets", "top-n-assets", "bottom-n-assets", "random-select-assets",
    "random-filter-assets", "asset-set-union", "asset-set-intersection",
    "asset-set-difference", "asset-set-count", "asset-set-any", "asset-set-all",
    "asset-set-n-of-m", "candidate-close", "candidate-return", "candidate-rsi",
    "candidate-compare", "asset-predicate-and", "asset-predicate-or", "asset-predicate-not",
}
OPTION_WORDS = {
    "option", "put", "call", "strike", "expiry", "expiration", "dte", "condor",
    "spread", "delta", "gamma", "vega", "iv", "implied volatility", "premium",
    "assignment", "wheel", "covered", "cash-secured", "iron fly", "strangle",
}
FINANCE_LIFECYCLE_WORDS = {
    "pca", "principal component", "residual", "pair trade", "pairs", "earnings",
    "eps", "fundamental", "dealer gamma", "gamma wall", "volatility risk premium",
    "model choose", "model-derived", "strategy performance", "child strategy",
}
EXTERNAL_JUDGMENT_WORDS = {
    "comfortable owning", "consider", "appears to form a bottom", "high-conviction",
    "acceptable", "research artifact", "backtests", "discretionary", "thesis",
    "major event", "geopolitical", "aggressive", "strong buyers", "orderly",
}


def text_for(row: dict[str, Any]) -> str:
    return " ".join(
        str(row.get(key, "")) for key in (
            "source_idea_paraphrase", "normalized_interpretation", "builder_primitive_needed",
            "ambiguous_or_fuzzy_terms", "research_note",
        )
    ).lower()


def has_any(text: str, values: set[str]) -> bool:
    return any(re.search(r"(?<![a-z0-9])" + re.escape(value) + r"(?![a-z0-9])", text) for value in values)


def split_required_primitives(row: dict[str, Any]) -> list[str]:
    return [item.strip() for item in str(row.get("builder_primitive_needed", "")).split(";") if item.strip()]


def classify(row: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    """Return primary class, independent blockers, and reasons.

    Classes deliberately describe the smallest blocking category, not an execution claim.
    D wins over C because an option/model lifecycle cannot be closed merely by adding common
    graph syntax.  E wins only when the fragment itself delegates a material decision to
    human/research input instead of asking for an ordinary numeric parameter.
    """
    text = text_for(row)
    blockers: list[str] = []
    reasons: list[str] = []
    if has_any(text, OPTION_WORDS):
        blockers.append("option_contract_or_lifecycle")
        reasons.append("requires option contract types, lifecycle, or order semantics")
    if has_any(text, FINANCE_LIFECYCLE_WORDS):
        blockers.append("specialized_finance_or_model_data")
        reasons.append("requires model, relationship, fundamental, or specialized market-data type")
    primitives = str(row.get("builder_primitive_needed", "")).lower()
    common_lifecycle = (
        "event sequence", "stateful", "state machine", "session event", "event object",
        "ordinal event", "pattern memory", "multi-timeframe", "cross-timeframe", "cooldown",
        "loop", "strategy composition", "strategy-as-block", "strategy-as-data", "event-relative",
        "time-window", "schedule gate", "debounce", "consecutive", "parallel",
    )
    if row.get("is_multi_timeframe"):
        blockers.append("multi_clock_context")
    if row.get("is_sequence") and any(term in primitives for term in common_lifecycle):
        blockers.append("event_order")
    if row.get("is_state") and any(term in primitives for term in common_lifecycle):
        blockers.append("state_or_memory")
    if row.get("is_event_relative") and any(term in primitives for term in common_lifecycle):
        blockers.append("event_relative_time")
    if row.get("is_fuzzy"):
        blockers.append("undefined_user_parameter")
    if row.get("is_exception"):
        blockers.append("exception_policy")
    if has_any(text, EXTERNAL_JUDGMENT_WORDS):
        blockers.append("external_judgment")
        reasons.append("material wording is discretionary, research-dependent, or external-event dependent")

    if any(item in blockers for item in ("option_contract_or_lifecycle", "specialized_finance_or_model_data")):
        return "D", blockers, reasons
    if "external_judgment" in blockers:
        return "E", blockers, reasons
    if any(item in blockers for item in ("event_order", "state_or_memory", "event_relative_time", "multi_clock_context")):
        return "C", blockers, reasons
    if blockers:
        return "B", blockers, reasons
    return "A", blockers, reasons


def evaluation_context(row: dict[str, Any]) -> str:
    text = text_for(row)
    if "candidate" in text or "universe" in text or "rank" in text or "stock" in text:
        return "per_asset_or_cross_section"
    if row.get("is_multi_timeframe"):
        return "multiple_completed_clocks"
    if row.get("is_event_relative"):
        return "event_relative_completed_observation"
    return "strategy_level_completed_observation"


def composition(row: dict[str, Any], primary: str) -> dict[str, Any]:
    text = text_for(row)
    nodes: list[dict[str, Any]] = []
    # Every corpus row is a fragment. An explicit object/universe is therefore never
    # inferred merely because the prose mentions a market or an asset class.
    unresolved: list[str] = ["explicit asset/object universe"]
    assumptions: list[str] = [
        "No clock, provider, universe, threshold, shortage policy, weighting policy, or order policy is inferred from the fragment.",
    ]
    if not str(row.get("timeframe_context", "")).strip() or str(row.get("timeframe_context", "")).strip().lower() == "unspecified":
        unresolved.append("evaluation clock")
    if row.get("is_fuzzy"):
        unresolved.append("formal definition for fuzzy term(s)")
    if primary == "D":
        nodes = [
            {"id": "proposed:finance-input", "block_type": "proposed:finance-input", "output": "specialized financial value", "typed_inputs": []},
            {"id": "proposed:finance-lifecycle", "block_type": "proposed:finance-lifecycle", "output": "Statement", "typed_inputs": ["specialized financial value"]},
        ]
        unresolved.extend(["instrument/provider contract", "execution lifecycle and risk policy"])
        graph_state = "unsupported_semantic_or_data_requirement"
    elif primary == "E":
        nodes = [{"id": "proposed:external-signal", "block_type": "proposed:external-signal", "output": "Truth | Value", "typed_inputs": []}]
        unresolved.append("explicit user or external-signal definition")
        graph_state = "unresolved_natural_language_meaning"
    else:
        nodes.append({"id": "input:asset-set", "block_type": "group-reference", "output": "AssetSet", "typed_inputs": []})
        if any(word in text for word in ("filter", "above", "below", "qualif", "oversold", "rsi", "sma", "volume", "missing")):
            indicator = "candidate-rsi" if "rsi" in text else "candidate-return" if "return" in text or "momentum" in text else "candidate-close"
            nodes.extend([
                {"id": "value:candidate", "block_type": indicator, "output": "CandidateValue", "typed_inputs": ["Duration"] if indicator != "candidate-close" else []},
                {"id": "predicate", "block_type": "candidate-compare", "output": "AssetPredicate", "typed_inputs": ["CandidateValue", "Value"]},
                {"id": "set:filtered", "block_type": "filter-assets", "output": "AssetSet", "typed_inputs": ["AssetSet", "AssetPredicate"]},
            ])
            unresolved.append("indicator lookback/threshold/provider policy")
        if "random" in text:
            block = "random-filter-assets" if any(word in text for word in ("probability", "retain", "exclude", "remov")) else "random-select-assets"
            nodes.append({"id": "set:random", "block_type": block, "output": "AssetSet", "typed_inputs": ["AssetSet", "Percentage" if block == "random-filter-assets" else "Number"], "inspector_required": ["seed", "redraw scope", "stable asset identity", "evaluation cutoff"]})
            unresolved.extend(["seed", "redraw scope"])
        if any(word in text for word in ("rank", "top", "highest", "best")):
            nodes.append({"id": "set:ranked", "block_type": "top-n-assets", "output": "AssetSet", "typed_inputs": ["AssetSet", "CandidateValue", "Number"]})
            unresolved.extend(["ranking metric", "count", "tie-break"])
        if any(word in text for word in ("bottom", "worst", "lowest")):
            nodes.append({"id": "set:ranked", "block_type": "bottom-n-assets", "output": "AssetSet", "typed_inputs": ["AssetSet", "CandidateValue", "Number"]})
            unresolved.extend(["ranking metric", "count", "tie-break"])
        if any(word in text for word in ("all ", "any ", "n-of-m", "multiple confirmations", "confluence")):
            aggregate = "asset-set-all" if "all " in text else "asset-set-any" if "any " in text else "asset-set-n-of-m"
            nodes.append({"id": "truth:aggregate", "block_type": aggregate, "output": "Truth", "typed_inputs": ["AssetSet", "AssetPredicate"]})
        if primary == "C":
            nodes.extend([
                {"id": "proposed:event", "block_type": "event-state sequence", "output": "State", "typed_inputs": ["Truth", "Duration"]},
                {"id": "proposed:action", "block_type": "invest | rebalance", "output": "Statement", "typed_inputs": ["Asset | AssetSet", "Percentage | Money | Quantity"]},
            ])
            unresolved.append("event/state transition and expiry policy")
            graph_state = "proposed_graph_requiring_new_grammar"
        else:
            graph_state = "parameterized_graph_requiring_user_input" if unresolved else "fully_instantiated_type_valid_graph"
    # Preserve order while removing repeated unresolved values.
    unresolved = list(dict.fromkeys(unresolved))
    known = {node["block_type"] for node in nodes if not str(node["block_type"]).startswith("proposed:") and " " not in str(node["block_type"])}
    current = known <= CURRENT_BLOCKS
    return {
        "graph_status": graph_state,
        "nodes": nodes,
        "statement_sequencing": bool(row.get("is_sequence") or row.get("is_strategy_composition")),
        "object_references": ["Group"] if any(node["block_type"] == "group-reference" for node in nodes) else [],
        "evaluation_context": evaluation_context(row),
        "semantic_assumptions": assumptions,
        "unresolved_inputs": unresolved,
        "uses_only_current_registered_blocks": current,
        "uses_new_p0_registered_blocks": bool(known & P0_BLOCKS),
    }


def metrics(graph: dict[str, Any]) -> dict[str, Any]:
    nodes = graph["nodes"]
    nested = sum(1 for node in nodes if node["id"].startswith(("set:", "truth:")))
    return {
        "block_count": len(nodes),
        "maximum_nesting_depth": min(4, 1 + nested),
        "required_named_objects": len(graph["object_references"]),
        "unresolved_parameters": len(graph["unresolved_inputs"]),
        "inspector_only_steps": sum(1 for node in nodes if node.get("inspector_required")),
        "mandatory_intermediate_operations": max(0, len(nodes) - 2),
        "custom_financial_blocks": sum(1 for node in nodes if str(node["block_type"]).startswith("proposed:") or node["block_type"] in P0_BLOCKS),
        "readable_with_inspector_closed": all(not node.get("inspector_required") for node in nodes),
    }


def capability(primary: str, graph: dict[str, Any]) -> dict[str, bool | None]:
    p0 = bool(graph["uses_new_p0_registered_blocks"])
    existing = bool(graph["uses_only_current_registered_blocks"])
    return {
        "visually_draftable": primary in {"A", "B", "C"},
        "typed_graph_valid": existing or p0,
        "semantically_representable": existing and primary in {"A", "B"},
        "reference_evaluable": False,
        "backend_lowerable": False,
        "docker_verified": False,
        "provider_supported": None,
        "ui_authorable": existing or p0,
        "runtime_executable": False,
    }


def case_record(row: dict[str, Any], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    primary, blockers, reasons = classify(row)
    graph = composition(row, primary)
    # The source corpus intentionally contains fragments, not completed strategies. Even
    # when their operations fit already-registered blocks, an omitted universe/clock/input
    # makes them parameterized candidates rather than current proven strategy coverage.
    if primary == "A":
        primary = "B"
        blockers = [*blockers, "fragment_requires_explicit_context"]
        reasons = [*reasons, "source fragment omits at least the explicit universe/object context required for a complete strategy"]
    # A/B only mean the existing registered grammar can express the fragment once its
    # inputs are supplied.  If the proposed graph needs a newly-added AssetSet primitive,
    # preserve that independent fact rather than calling it current coverage.
    if primary in {"A", "B"} and graph["uses_new_p0_registered_blocks"]:
        primary = "C"
        blockers = [*blockers, "asset_set_composition"]
        reasons = [*reasons, "requires a direct AssetSet operation that was not in the prior registered grammar"]
        graph["graph_status"] = "proposed_graph_requiring_new_grammar"
    return {
        "case_id": row["case_id"],
        "source": {key: row.get(key, "") for key in ("source", "source_url", "community", "source_date", "evidence_level", "research_note")},
        "original_fragment": row.get("source_idea_paraphrase", ""),
        "normalized_interpretation": row.get("normalized_interpretation", ""),
        "ambiguity": {"terms": row.get("ambiguous_or_fuzzy_terms", ""), "is_fuzzy": bool(row.get("is_fuzzy")), "is_exception": bool(row.get("is_exception"))},
        "dependencies": {
            "sequence": row.get("sequence_dependency", ""), "state": row.get("state_dependency", ""), "exception": row.get("exception_or_override", ""),
            "timeframe": row.get("timeframe_context", ""), "is_sequence": bool(row.get("is_sequence")), "is_state": bool(row.get("is_state")),
            "is_multi_timeframe": bool(row.get("is_multi_timeframe")), "is_event_relative": bool(row.get("is_event_relative")),
        },
        "original_required_primitives": split_required_primitives(row),
        "intended_logical_operation": row.get("normalized_interpretation") or row.get("source_idea_paraphrase"),
        "required_input_types": ["explicit universe/object", "explicit parameters"],
        "output_types": ["Truth | AssetSet | Value | Statement, depending on unresolved composition"],
        "required_evaluation_context": evaluation_context(row),
        "required_external_data": "provider contract unresolved" if primary in {"D", "E"} else "market/provider readiness must be selected explicitly",
        "primary_classification": primary,
        "previous_review_hypothesis": None if previous is None else {
            "classification": previous.get("category", ""), "required_packages": previous.get("required", ""),
            "reason": previous.get("reason", ""), "flags": previous.get("flags", ""),
        },
        "secondary_blockers": blockers,
        "classification_reasons": reasons,
        "possible_blocky_composition": graph,
        "missing_primitives": [node["block_type"] for node in graph["nodes"] if str(node["block_type"]).startswith("proposed:")],
        "current_implementation_support": capability(primary, graph),
        "minimal_proposed_extension": "none beyond explicit parameters" if primary in {"A", "B"} else "typed compositional primitive(s) or dedicated financial/external contract",
        "complexity": metrics(graph),
    }


def review_markdown(records: list[dict[str, Any]], coverage: dict[str, Any]) -> str:
    lines = [
        "# 169-case Blocky expressiveness review",
        "",
        "This is a case-level reconciliation of the supplied natural-language fragments. A fragment is not counted as an executable strategy, and a graph marked draftable is not claimed lowerable or Docker-verified.",
        "",
        "## Recomputed classification",
        "",
        "| Class | Meaning | Cases |",
        "|---|---|---:|",
    ]
    labels = {"A": "Expressible with current grammar", "B": "Expressible after parameter definition", "C": "Requires common compositional grammar", "D": "Requires finance-specific type/lifecycle", "E": "Requires external judgment/unprovided semantics"}
    for key in "ABCDE": lines.append(f"| {key} | {labels[key]} | {coverage['primary_classification_counts'].get(key, 0)} |")
    lines.extend(["", "## Per-case evidence", "", "| ID | Class | Source interpretation | Primary blockers | Composition status |", "|---|---:|---|---|---|"])
    for record in records:
        phrase = record["normalized_interpretation"].replace("|", "/")[:150]
        blockers = ", ".join(record["secondary_blockers"]) or "none"
        lines.append(f"| {record['case_id']} | {record['primary_classification']} | {phrase} | {blockers} | {record['possible_blocky_composition']['graph_status']} |")
    lines.extend(["", "The complete machine-readable inputs, assumptions, typed nodes, unresolved inputs, capability dimensions, and complexity metrics are in `corpus/blocky-169-case-matrix.json`."])
    return "\n".join(lines) + "\n"


def grammar_contract() -> str:
    return """# Composable Blocky grammar contract

## AssetSet expressions

`Group` and `Subgroup` are compatible AssetSet inputs. `Filter AssetSet`, `Top N AssetSet`, `Bottom N AssetSet`, random selection/filter, union, intersection and difference all output an anonymous `AssetSet`; none allocates capital. An AssetSet may nest in another AssetSet operation or be supplied directly to an Investment only when the subsequent weighting policy is explicit.

## Evaluation context

`Candidate close`, `Candidate return`, and `Candidate RSI` output `CandidateValue` only inside an AssetSet operation. `candidate A > B` turns this into an `AssetPredicate`. It cannot attach to a strategy-level `IF` as though it were global `Truth`. `Any`, `All`, and `N-of-M` explicitly aggregate an AssetSet + AssetPredicate into strategy-level `Truth`.

## Random contract

`Random N` selects exactly N members. `Random Filter` independently retains each member with probability P. They are distinct. Both require an explicit seed and redraw scope (`per evaluation`, `per schedule`, or `per strategy`) in the block. Deterministic execution is deliberately not claimed until reference and LEAN evidence define cutoff, stable asset identity, ordering, and restart/replay behavior.

## Capability boundary

The newly registered AssetSet primitives are Working Draft grammar. Their typed Blockly connections and serialization are tested, but they do not automatically translate into `SemanticProgramV2`, the reference evaluator, or LEAN. Existing verified Group/Choose/Investment paths remain unchanged.
"""


def implementation_gap(coverage: dict[str, Any]) -> str:
    return f"""# Blocky implementation gap

## Implemented in this change

- typed anonymous AssetSet composition: filter, top/bottom N, random exact-N, random independent filter, union/intersection/difference;
- candidate-scoped values and predicates distinct from strategy-level Truth;
- aggregate Any/All/N-of-M and AssetSet count;
- deterministic random draft metadata (seed/redraw scope), native Blockly serialization, and connection tests;
- case-level corpus, reproducible classification, and conservative capability accounting.

## Explicitly not claimed

- new AssetSet primitives are not yet committed `SemanticProgramV2` operations or lowerable execution;
- no random reference/LEAN/restart evidence is claimed;
- options, pair/model/fundamental data, event calendars, execution policies, and external discretionary judgments remain outside this package;
- no numerical threshold, timeframe, provider, risk, allocation, or order policy was inferred from corpus prose.

## Measured result

The source denominator is exactly {coverage['denominator']}. New P0 grammar makes {coverage['p0_draftable_cases']} fragments additionally draftable as typed compositions, while post-implementation executable/Docker-proven count remains {coverage['post_implementation_proven_execution']} by design.
"""


def acceptance_compositions() -> list[dict[str, Any]]:
    """Representative multi-fragment journeys; capability is deliberately per journey."""
    return [
        {"id": "single-asset-monthly-investment", "blocks": ["start-monthly", "asset-reference", "invest"], "status": "existing_authoring_path", "execution": "maintained bounded profile"},
        {"id": "filter-only-rsi", "blocks": ["group-reference", "candidate-rsi", "candidate-compare", "filter-assets"], "status": "typed_working_draft", "execution": "not lowered"},
        {"id": "random-n-selection", "blocks": ["group-reference", "random-select-assets"], "status": "typed_working_draft", "execution": "not lowered; seed/redraw required"},
        {"id": "multi-condition-filter", "blocks": ["candidate-return", "candidate-compare", "candidate-rsi", "asset-predicate-and", "filter-assets"], "status": "typed_working_draft", "execution": "not lowered"},
        {"id": "filter-random-filter-filter", "blocks": ["filter-assets", "random-filter-assets", "asset-predicate-and", "filter-assets"], "status": "typed_working_draft", "execution": "not lowered"},
        {"id": "momentum-top-n-fallback", "blocks": ["group-reference", "choose-group", "invest", "rebalance"], "status": "existing_authoring_path", "execution": "maintained bounded profile when complete"},
        {"id": "weighted-score-proportional-allocation", "blocks": ["group-reference", "weighted-score", "choose-group", "rebalance"], "status": "existing_semantic_recipe", "execution": "existing Docker-verified profile; visual recipe remains bounded"},
        {"id": "conditional-growth-defensive", "blocks": ["start-monthly", "compare-gt", "if-otherwise", "rebalance"], "status": "existing_semantic_recipe", "execution": "bounded maintained profile when complete"},
        {"id": "event-state-breakout-retest", "blocks": ["start-daily", "remember-value", "state", "if-otherwise", "invest"], "status": "existing_semantic_recipe", "execution": "requires existing temporal authoring path"},
        {"id": "weekly-context-daily-decision", "blocks": ["start-weekly", "start-daily", "state", "if-otherwise", "rebalance"], "status": "existing_semantic_recipe", "execution": "requires existing completed-weekly path"},
        {"id": "dynamic-partial-rebalance", "blocks": ["asset-value", "compare-gt", "if-otherwise", "rebalance"], "status": "parameterized_candidate", "execution": "partial-rebalance policy not newly lowered"},
        {"id": "n-of-m-confirmation", "blocks": ["group-reference", "candidate-compare", "asset-set-n-of-m", "if-otherwise"], "status": "typed_working_draft", "execution": "not lowered"},
        {"id": "reusable-named-function", "blocks": ["create-function", "function-input", "function-return", "call-function"], "status": "typed_working_draft", "execution": "not lowered"},
        {"id": "multi-sleeve-strategy", "blocks": ["group-reference", "choose-group", "rebalance"], "status": "existing_semantic_recipe", "execution": "existing composable split profile only"},
        {"id": "options-wheel-audit", "blocks": ["proposed:option-lifecycle", "proposed:contract-selector", "proposed:assignment-event"], "status": "representation_audit", "execution": "unsupported finance lifecycle"},
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("corpus/blocky-169-source.jsonl"))
    parser.add_argument("--previous-review", type=Path, default=Path("corpus/blocky-169-previous-review-hypothesis.json"), help="Prior machine-readable review; retained as a non-authoritative hypothesis.")
    parser.add_argument("--corpus-dir", type=Path, default=Path("corpus"))
    parser.add_argument("--docs-dir", type=Path, default=Path("docs"))
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.input.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) != 169 or len({row.get("case_id") for row in rows}) != 169:
        raise SystemExit("Expected exactly 169 unique source case IDs")
    previous_by_id: dict[str, dict[str, Any]] = {}
    previous_counts: dict[str, Any] | None = None
    if args.previous_review:
        previous_payload = json.loads(args.previous_review.read_text(encoding="utf-8"))
        previous_by_id = {str(case.get("id")): case for case in previous_payload.get("cases", [])}
        if len(previous_by_id) != 169:
            raise SystemExit("prior review must contain exactly 169 unique case IDs when supplied")
        previous_counts = previous_payload.get("counts")
    records = [case_record(row, previous_by_id.get(str(row["case_id"]))) for row in rows]
    primary = Counter(record["primary_classification"] for record in records)
    blockers = Counter(blocker for record in records for blocker in record["secondary_blockers"])
    statuses = Counter(record["possible_blocky_composition"]["graph_status"] for record in records)
    p0_draftable = sum(record["possible_blocky_composition"]["uses_new_p0_registered_blocks"] for record in records)
    coverage = {
        "schema": "ruletrade.dev/blocky-169-coverage/v1",
        "denominator": len(records),
        "primary_classification_counts": dict(sorted(primary.items())),
        "secondary_blocker_counts": dict(sorted(blockers.items())),
        "composition_status_counts": dict(sorted(statuses.items())),
        "current_proven_coverage": sum(record["primary_classification"] == "A" and record["current_implementation_support"]["semantically_representable"] for record in records),
        "parameter_dependent_coverage": sum(record["primary_classification"] == "B" for record in records),
        "p0_draftable_cases": p0_draftable,
        "post_implementation_proven_execution": 0,
        "previous_review_hypothesis_counts": previous_counts,
        "counterexamples": {
            "AssetSet": "Filter(SP500, RSI(14) < 10) is type-valid Working Draft composition but has no new SemanticProgramV2 lowering in this change.",
            "Random": "Random N and independent random filtering remain non-executable until seed/cutoff/order/restart semantics have reference and LEAN evidence.",
            "Aggregate": "Count(Filter(group, predicate)) > 5 is distinct from a candidate predicate and is not silently lowered as one.",
        },
    }
    fixtures = {"schema": "ruletrade.dev/blocky-169-composition-fixtures/v1", "fixtures": [
        {"id": record["case_id"], "graph": record["possible_blocky_composition"], "complexity": record["complexity"]} for record in records
    ], "acceptance_compositions": acceptance_compositions()}
    args.corpus_dir.mkdir(parents=True, exist_ok=True)
    args.docs_dir.mkdir(parents=True, exist_ok=True)
    (args.corpus_dir / "blocky-169-case-matrix.json").write_text(json.dumps({"schema": "ruletrade.dev/blocky-169-case-matrix/v1", "source_case_count": 169, "cases": records}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.corpus_dir / "blocky-feature-coverage.json").write_text(json.dumps(coverage, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.corpus_dir / "blocky-composition-fixtures.json").write_text(json.dumps(fixtures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.docs_dir / "blocky-169-case-review.md").write_text(review_markdown(records, coverage), encoding="utf-8")
    (args.docs_dir / "blocky-grammar-contract.md").write_text(grammar_contract(), encoding="utf-8")
    (args.docs_dir / "blocky-implementation-gap.md").write_text(implementation_gap(coverage), encoding="utf-8")


if __name__ == "__main__":
    main()
