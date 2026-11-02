#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
work="$repo_root/build/lean/static-program-e2e"
fixture="$repo_root/build/lean/lean-filter-data"
cd "$repo_root"
rm -rf "$work" "$fixture"
PYTHONPATH=src ruletrade_python scripts/generate_golden_lean_fixture.py --profile filter --output "$fixture"
for profile in direct choose split conditional; do
  PYTHONPATH=src ruletrade_python scripts/generate_static_program_lean.py \
    --profile "$profile" --output "$work/$profile/Main.cs"
  PYTHONPATH=src ruletrade_python scripts/run_lean_backtest.py \
    --source "$work/$profile/Main.cs" --output-dir "$work/$profile" --dataset-id filter-synthetic
  PYTHONPATH=src ruletrade_python scripts/verify_static_program_lean_e2e.py \
    --profile "$profile" --log "$work/$profile/lean.log" \
    --result "$work/$profile/backtest-result.json" --fixture "$fixture"
done
