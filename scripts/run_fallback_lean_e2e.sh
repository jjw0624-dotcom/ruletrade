#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"

work="$repo_root/build/lean/fallback-e2e"
cd "$repo_root"
rm -rf "$work"
PYTHONPATH=src ruletrade_python scripts/generate_fallback_lean.py --output "$work/Main.cs"
PYTHONPATH=src ruletrade_python scripts/run_lean_backtest.py \
  --source "$work/Main.cs" \
  --output-dir "$work" \
  --dataset-id filter-synthetic
PYTHONPATH=src ruletrade_python scripts/verify_fallback_lean_e2e.py \
  --log "$work/lean.log" \
  --result "$work/backtest-result.json"
