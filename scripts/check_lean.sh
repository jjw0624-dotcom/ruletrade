#!/usr/bin/env bash
set -euo pipefail

mode="${1:-all}"
if [[ "$mode" != "all" && "$mode" != "--generate-only" && "$mode" != "--compile-only" ]]; then
  echo "usage: $0 [--generate-only|--compile-only]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

names=(golden momentum filter fallback sleeves independent-schedules cooldown candidate one-investment)
generators=(
  generate_golden_lean.py
  generate_momentum_lean.py
  generate_filter_lean.py
  generate_fallback_lean.py
  generate_sleeves_lean.py
  generate_independent_schedules_lean.py
  generate_cooldown_lean.py
  generate_candidate_lean.py
  generate_one_investment_lean.py
)

if [[ "$mode" != "--compile-only" ]]; then
  for index in "${!names[@]}"; do
    output="build/lean/${names[$index]}-ci/Main.cs"
    PYTHONPATH=src uv run python "scripts/${generators[$index]}" --output "$output"
  done
fi

if [[ "$mode" == "--generate-only" ]]; then
  exit 0
fi

for name in "${names[@]}"; do
  ./scripts/build_golden_lean_docker.sh \
    "build/lean/${name}-ci/Main.cs" \
    "build/lean/${name}-ci/bin"
  test -f "build/lean/${name}-ci/bin/RuleTradeGenerated.dll"
done
