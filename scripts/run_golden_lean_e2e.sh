#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"

image="${RULETRADE_LEAN_IMAGE:-quantconnect/lean:latest}"
work="$repo_root/build/lean/e2e"
log="$work/lean.log"
result="$work/backtest-result.json"

cd "$repo_root"
rm -rf "$work"
PYTHONPATH=src RULETRADE_LEAN_IMAGE="$image" ruletrade_python scripts/generate_golden_lean.py
PYTHONPATH=src RULETRADE_LEAN_IMAGE="$image" ruletrade_python scripts/run_lean_backtest.py \
  --source build/lean/Main.cs \
  --output-dir "$work"

PYTHONPATH=src ruletrade_python scripts/verify_lean_e2e.py \
  --log "$log" \
  --result "$result"
