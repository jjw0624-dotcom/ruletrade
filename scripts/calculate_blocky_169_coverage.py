#!/usr/bin/env python3
"""Recompute the published Blocky 169-case totals from the case-level matrix."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("matrix", type=Path, nargs="?", default=Path("corpus/blocky-169-case-matrix.json"))
    args = parser.parse_args()
    payload = json.loads(args.matrix.read_text(encoding="utf-8"))
    cases = payload["cases"]
    if len(cases) != 169 or len({case["case_id"] for case in cases}) != 169:
        raise SystemExit("matrix must contain exactly 169 unique case IDs")
    result = {
        "denominator": len(cases),
        "primary_classification_counts": dict(sorted(Counter(case["primary_classification"] for case in cases).items())),
        "secondary_blocker_counts": dict(sorted(Counter(blocker for case in cases for blocker in case["secondary_blockers"]).items())),
        "composition_status_counts": dict(sorted(Counter(case["possible_blocky_composition"]["graph_status"] for case in cases).items())),
        "current_proven_coverage": sum(case["primary_classification"] == "A" and case["current_implementation_support"]["semantically_representable"] for case in cases),
        "parameter_dependent_coverage": sum(case["primary_classification"] == "B" for case in cases),
        "p0_draftable_cases": sum(case["possible_blocky_composition"]["uses_new_p0_registered_blocks"] for case in cases),
        "post_implementation_proven_execution": 0,
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
