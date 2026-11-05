from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.authoring import (
    ApplyV2AuthoringRequest,
    CommitMultiClockPolicyIntent,
    CommitTemporalSequenceIntent,
    CommitWeightedScoreIntent,
    ProgramStrategyTemplateRequest,
    apply_v2_authoring,
    create_program_strategy_template,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "corpus" / "advanced-ui-authored-execution-equivalence.json"


def build() -> dict:
    source = create_program_strategy_template(
        ProgramStrategyTemplateRequest(name="Advanced UI Authored")
    )
    operations = (
        CommitWeightedScoreIntent(
            kind="commit_weighted_score_intent",
            assets=("QQQ", "VGT", "SOXX", "SCHG"),
            short_observations=21,
            long_observations=63,
            short_weight=Decimal("0.6"),
            long_weight=Decimal("0.4"),
            count=3,
            timeframe="monthly",
            missing_policy="require_all",
        ),
        CommitTemporalSequenceIntent(
            kind="commit_temporal_sequence_intent",
            asset="QQQ",
            breakout_threshold=Decimal("12"),
            retest_window=3,
            confirmation_window=2,
            expiry_state="expired",
        ),
        CommitMultiClockPolicyIntent(
            kind="commit_multi_clock_policy_intent",
            assets=("QQQ", "VGT", "SOXX", "SCHG"),
            weekly_context_asset="QQQ",
            weekly_threshold=Decimal("0"),
            daily_signal_asset="QQQ",
            daily_threshold=Decimal("0"),
            score_observations=(21, 63),
            score_weights=(Decimal("0.6"), Decimal("0.4")),
            count=2,
            fallback_asset="TLT",
            unknown_risk_policy="block",
        ),
    )
    cases = []
    for operation in operations:
        strategy = apply_v2_authoring(
            ApplyV2AuthoringRequest(
                strategy=source,
                expected_source_hash=strategy_hash(source),
                operation=operation,
            )
        ).strategy
        cases.append(
            {
                "id": operation.kind.removeprefix("commit_").removesuffix("_intent"),
                # Browser requests serialize numeric controls as JSON numbers.
                # Canonical Decimal values remain string encoded below.
                "operation": json.loads(
                    json.dumps(operation.model_dump(), default=lambda value: float(value))
                ),
                "expected_canonical": strategy.model_dump(mode="json"),
            }
        )
    return {
        "schema": "ruletrade.advanced-ui-authored-equivalence.v1",
        "invariant": "Production gestures, backend authoring, persistence, projections, and execution use the same committed V2 meaning.",
        "cases": cases,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"{OUTPUT.relative_to(ROOT)} is stale")
        return
    OUTPUT.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
