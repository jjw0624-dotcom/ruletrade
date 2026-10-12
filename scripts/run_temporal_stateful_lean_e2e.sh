#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"

work="$repo_root/build/lean/temporal-stateful-e2e"
fixture="$repo_root/build/lean/lean-temporal-data"
cd "$repo_root"
rm -rf "$work" "$fixture"
PYTHONPATH=src ruletrade_python scripts/generate_golden_lean_fixture.py --profile temporal --output "$fixture"
PYTHONPATH=src ruletrade_python scripts/generate_temporal_stateful_lean.py --output "$work/Main.cs"
PYTHONPATH=src ruletrade_python scripts/run_lean_backtest.py \
  --source "$work/Main.cs" --output-dir "$work" --dataset-id temporal-synthetic
PYTHONPATH=src ruletrade_python scripts/verify_temporal_stateful_lean_e2e.py \
  --log "$work/lean.log" --result "$work/backtest-result.json" --fixture "$fixture"
