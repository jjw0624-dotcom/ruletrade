from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


STATUS_VALUES = {"PASS", "FAIL", "NOT_PROVEN", "UNSUPPORTED"}


def _number(case_id: str) -> int:
    return int(case_id[2:])


def semantic_family(case_id: str) -> str:
    number = _number(case_id)
    if number in {*range(1, 11), *range(47, 53)}:
        return "opening-range-event-sequence"
    if number in {*range(11, 14), *range(87, 94)}:
        return "multi-clock-context-confirmation"
    if number in {*range(14, 35), *range(53, 69)}:
        return "options-position-lifecycle"
    if number in {35, 36, 37}:
        return "portfolio-band-rebalance"
    if number in {38, 41, 42}:
        return "cross-sectional-selection-risk"
    if number in {39, 40, *range(123, 130)}:
        return "meta-strategy-allocation"
    if number in {43, 69, 70, 74, 77}:
        return "session-execution-policy"
    if number in {44, 52, 72, 78}:
        return "risk-and-exit-policy"
    if number in {45, 46}:
        return "named-policy-dispatch"
    if number in {71, 90}:
        return "confluence-condition"
    if number in {73, 76, 79, 80, 83}:
        return "options-selection-policy"
    if number in {75, 81, 82, 84, 85, 86}:
        return "external-event-data-gate"
    if number in {94, 95, 96, 97, 98, 99, 100, 101}:
        return "strategy-as-data-composition"
    if number in {102, 103, 104, 105, 106, 119, 120, 121}:
        return "regime-classification-state"
    if number in {107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 122}:
        return "adaptive-composite-policy"
    if number in {130, 131, 132}:
        return "fundamental-event-factor"
    if number in {*range(133, 140), 147}:
        return "cross-sectional-factor-pipeline"
    if number in {*range(140, 144), *range(149, 158)}:
        return "model-and-mean-reversion-pipeline"
    if number in {144, 145, 146}:
        return "pair-relationship-model"
    if number == 148:
        return "stateful-schedule-gate"
    if number in {*range(158, 170)}:
        return "multi-leg-options-management"
    raise ValueError(f"unclassified expanded case: {case_id}")


def existing_overlap(family: str) -> list[str]:
    return {
        "opening-range-event-sequence": [
            "price-crosses-level", "remember-entry-level", "event-relative-stop",
            "breakout-retest-confirmation",
        ],
        "multi-clock-context-confirmation": [
            "higher-timeframe-context", "two-of-three-confirmation",
        ],
        "options-position-lifecycle": ["options-collar"],
        "portfolio-band-rebalance": ["overlapping-sleeve-exposure"],
        "cross-sectional-selection-risk": [
            "strongest-etfs", "multi-clause-screen", "composite-factor-rerank",
        ],
        "meta-strategy-allocation": ["risk-off-override", "overlapping-sleeve-exposure"],
        "session-execution-policy": [],
        "risk-and-exit-policy": ["event-relative-stop"],
        "named-policy-dispatch": ["risk-off-override"],
        "confluence-condition": ["two-of-three-confirmation"],
        "options-selection-policy": ["options-collar"],
        "external-event-data-gate": ["price-volume-liquidity-screen"],
        "strategy-as-data-composition": ["pca-statistical-arbitrage"],
        "regime-classification-state": ["risk-off-override", "state-aware-reentry"],
        "adaptive-composite-policy": [
            "composite-factor-rerank", "two-of-three-confirmation", "risk-off-override",
        ],
        "fundamental-event-factor": ["fundamental-value-ranking"],
        "cross-sectional-factor-pipeline": [
            "candidate-over-group-median", "composite-factor-rerank",
        ],
        "model-and-mean-reversion-pipeline": [
            "pca-statistical-arbitrage", "price-over-sma",
            "weighted-momentum-score-allocation",
        ],
        "pair-relationship-model": ["pairs-cointegration"],
        "stateful-schedule-gate": ["first-monthly-event", "state-aware-reentry"],
        "multi-leg-options-management": ["options-collar"],
    }[family]


def operator_gaps(family: str) -> list[str]:
    return {
        "opening-range-event-sequence": ["intraday_session_clock", "OHLC_structural_level"],
        "multi-clock-context-confirmation": ["intraday_clock", "general_multiclock_LEAN"],
        "options-position-lifecycle": ["option_contract", "position_lifecycle", "assignment"],
        "portfolio-band-rebalance": ["portfolio_drift_state", "partial_rebalance"],
        "cross-sectional-selection-risk": ["risk_sizing", "multi_schedule"],
        "meta-strategy-allocation": ["strategy_output_value", "child_strategy_identity"],
        "session-execution-policy": ["intraday_session_clock", "order_type_policy"],
        "risk-and-exit-policy": ["position_state", "order_lifecycle", "OCO"],
        "named-policy-dispatch": ["strategy_module"],
        "confluence-condition": [],
        "options-selection-policy": ["option_chain_query", "contract_selection"],
        "external-event-data-gate": ["external_event_provider", "options_positioning_provider"],
        "strategy-as-data-composition": ["strategy_output_series", "strategy_module"],
        "regime-classification-state": ["categorical_score_mapping", "strategy_module"],
        "adaptive-composite-policy": ["adaptive_weight_state", "general_policy_LEAN"],
        "fundamental-event-factor": ["PIT_fundamentals", "corporate_event_clock"],
        "cross-sectional-factor-pipeline": ["PIT_factor_provider", "dual_tail_targets"],
        "model-and-mean-reversion-pipeline": ["model_fit", "raw_OHLC", "position_lifecycle"],
        "pair-relationship-model": ["relationship_identity", "rolling_model_fit", "long_short"],
        "stateful-schedule-gate": ["long_horizon_schedule_counter", "general_state_LEAN"],
        "multi-leg-options-management": ["multi_leg_option", "atomic_position_mutation"],
    }[family]


def provider_dependencies(case: dict[str, object], family: str) -> list[str]:
    clusters = set(case["semantic_clusters"])
    result = ["adjusted_close"]
    if "external_data" in clusters:
        result.append("uncontracted_external_data")
    if "options_lifecycle" in clusters or "options" in family:
        result.append("option_chain_and_lifecycle")
    if family in {"fundamental-event-factor", "cross-sectional-factor-pipeline"}:
        result.append("point_in_time_fundamentals")
    if "model_statistical" in clusters:
        result.append("model_fit_inputs")
    return sorted(set(result))


def audit_status(case: dict[str, object], family: str, gaps: list[str]) -> str:
    if case["flags"]["is_fuzzy"]:
        return "ambiguous"
    if family in {
        "options-position-lifecycle", "options-selection-policy",
        "multi-leg-options-management", "strategy-as-data-composition",
        "fundamental-event-factor", "model-and-mean-reversion-pipeline",
        "pair-relationship-model",
    }:
        return "unsupported"
    if "uncontracted_external_data" in provider_dependencies(case, family):
        return "provider_blocked"
    return "partial"


def capabilities(status: str, family: str, providers: list[str]) -> dict[str, str]:
    missing_language = status == "unsupported"
    provider_blocked = any(value != "adjusted_close" for value in providers)
    representable = "UNSUPPORTED" if missing_language else "NOT_PROVEN"
    reference = "UNSUPPORTED" if missing_language else "NOT_PROVEN"
    lowerable = "UNSUPPORTED" if missing_language else "NOT_PROVEN"
    return {
        "representable": representable,
        "reference_evaluable": reference,
        "backend_lowerable": lowerable,
        "docker_verified": "UNSUPPORTED" if missing_language else "NOT_PROVEN",
        "provider_supported": "UNSUPPORTED" if provider_blocked else "PASS",
        "ui_authorable": "UNSUPPORTED" if missing_language else "NOT_PROVEN",
    }


def family_contract(family: str) -> dict[str, object]:
    contracts = {
        "opening-range-event-sequence": (["price", "condition", "event", "state", "remembered_value"], ["asset", "time"], ["intraday_session"], "reference_abstractions_only"),
        "multi-clock-context-confirmation": (["clocked_value", "condition", "event", "state"], ["asset", "time"], ["intraday", "daily", "weekly"], "reference_abstractions_only"),
        "options-position-lifecycle": (["contract", "position", "assignment", "state", "policy"], ["asset", "contract", "time"], ["session", "expiry_event"], "unsupported"),
        "portfolio-band-rebalance": (["portfolio_state", "condition", "allocation"], ["asset", "time"], ["daily", "rebalance_event"], "semantic_gap"),
        "cross-sectional-selection-risk": (["value", "condition", "score", "selection", "allocation"], ["asset", "time"], ["daily", "weekly", "monthly"], "partial_execution"),
        "meta-strategy-allocation": (["strategy_output", "score", "allocation", "state"], ["strategy", "time"], ["daily", "monthly"], "semantic_gap"),
        "session-execution-policy": (["session", "event", "order_policy"], ["asset", "time"], ["intraday_session"], "unsupported"),
        "risk-and-exit-policy": (["position_state", "event", "order_policy"], ["asset", "time"], ["intraday", "daily"], "semantic_gap"),
        "named-policy-dispatch": (["strategy_module", "state", "policy"], ["strategy", "time"], ["daily"], "semantic_gap"),
        "confluence-condition": (["condition", "n_of_m", "score"], ["asset", "time"], ["daily", "multi_clock"], "reference_evaluable"),
        "options-selection-policy": (["contract_query", "selection", "policy"], ["asset", "contract", "time"], ["session", "expiry_event"], "unsupported"),
        "external-event-data-gate": (["external_value", "condition", "policy"], ["asset", "time"], ["session", "event"], "provider_blocked"),
        "strategy-as-data-composition": (["strategy_output", "history", "indicator", "dispatch"], ["strategy", "time"], ["intraday", "daily"], "unsupported"),
        "regime-classification-state": (["score", "categorical_state", "policy"], ["asset", "time"], ["multi_clock"], "reference_abstractions_only"),
        "adaptive-composite-policy": (["score", "state", "event", "policy", "allocation"], ["asset", "time"], ["multi_clock"], "reference_abstractions_only"),
        "fundamental-event-factor": (["fundamental_value", "event_relative_value", "score", "selection"], ["asset", "time"], ["corporate_event", "monthly"], "provider_blocked"),
        "cross-sectional-factor-pipeline": (["cross_section", "score", "selection", "allocation"], ["asset", "time"], ["monthly"], "reference_partial"),
        "model-and-mean-reversion-pipeline": (["model_fit", "rolling_value", "condition", "allocation"], ["asset", "time", "model"], ["daily", "monthly"], "unsupported"),
        "pair-relationship-model": (["relationship", "model_fit", "event", "long_short"], ["relationship", "asset", "time"], ["daily"], "unsupported"),
        "stateful-schedule-gate": (["schedule", "counter_state", "guard"], ["time"], ["monthly", "multi_year"], "reference_abstractions_only"),
        "multi-leg-options-management": (["multi_leg_position", "state", "atomic_action"], ["contract", "time"], ["session", "expiry_event"], "unsupported"),
    }
    types, axes, clocks, support = contracts[family]
    return {"types": types, "axes": axes, "clocks": clocks, "current_support": support}


def reconcile(source: dict[str, object]) -> dict[str, object]:
    urls = sorted({case["source"]["url"] for case in source["cases"]})
    source_ids = {url: f"SRC{index:03d}" for index, url in enumerate(urls, start=1)}
    cases = []
    for case in source["cases"]:
        family = semantic_family(case["case_id"])
        gaps = operator_gaps(family)
        providers = provider_dependencies(case, family)
        status = audit_status(case, family, gaps)
        capability = capabilities(status, family, providers)
        assert set(capability.values()) <= STATUS_VALUES
        signature_material = {
            "family": family,
            "requirements": sorted(case["requirements_from_flags"]),
            "operators": sorted(gaps),
            "providers": providers,
        }
        signature = hashlib.sha256(
            json.dumps(signature_material, sort_keys=True).encode()
        ).hexdigest()[:16]
        cases.append({
            **case,
            "audit": {
                "source_group_id": source_ids[case["source"]["url"]],
                "semantic_family": family,
                "combination_signature": signature,
                "case_kind": "strategy_fragment",
                "status": status,
                "existing_corpus_overlap": existing_overlap(family),
                "operator_gaps": gaps,
                "provider_dependencies": providers,
                "capabilities": capability,
                "evidence_ids": [
                    f"expanded-source:{case['case_id']}",
                    f"expanded-family:{family}",
                    f"expanded-audit:{case['case_id']}",
                ],
                "execution_claim": "No complete-strategy execution claim is made from this fragment.",
            },
        })
    family_counts = Counter(item["audit"]["semantic_family"] for item in cases)
    status_counts = Counter(item["audit"]["status"] for item in cases)
    signature_counts = Counter(item["audit"]["combination_signature"] for item in cases)
    families = sorted(family_counts)
    return {
        "schema_version": "ruletrade.dev/expanded-semantic-case-matrix/v1",
        "source": {
            "file": source["source_file"],
            "bundled_original_jsonl": False,
            "evidence_level": "source-grounded paraphrases; URLs not independently verified",
            "warning": source["warning"],
        },
        "summary": {
            "raw_cases": len(cases),
            "source_groups": len(source_ids),
            "deduplicated_semantic_families": len(family_counts),
            "deduplicated_combination_signatures": len(signature_counts),
            "case_kind_counts": {"strategy_fragment": len(cases), "complete_strategy": 0},
            "audit_status_counts": dict(sorted(status_counts.items())),
            "semantic_family_counts": dict(sorted(family_counts.items())),
        },
        "family_gap_matrix": [
            {
                "family": family,
                "raw_case_count": family_counts[family],
                "sample_case_ids": [
                    item["case_id"] for item in cases
                    if item["audit"]["semantic_family"] == family
                ][:5],
                **family_contract(family),
                "operator_gaps": operator_gaps(family),
                "provider_dependencies": sorted({
                    dependency
                    for item in cases
                    if item["audit"]["semantic_family"] == family
                    for dependency in item["audit"]["provider_dependencies"]
                }),
            }
            for family in families
        ],
        "cases": cases,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile the expanded semantic research corpus")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path,
        default=Path("corpus/expanded-semantic-case-matrix.json"),
    )
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8"))
    result = reconcile(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
