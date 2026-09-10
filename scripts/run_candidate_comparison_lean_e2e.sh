#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"

work="$repo_root/build/lean/candidate-comparison-e2e"
cd "$repo_root"
rm -rf "$work"
PYTHONPATH=src ruletrade_python scripts/run_candidate_comparison_lean_e2e.py \
  --database "$work/ruletrade.sqlite3"
