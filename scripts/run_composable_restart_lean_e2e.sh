#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
work="$repo_root/build/lean/composable-restart-e2e"
fixture="$repo_root/build/lean/lean-filter-data"
cd "$repo_root"
rm -rf "$work" "$fixture"
mkdir -p "$work"
PYTHONPATH=src ruletrade_python scripts/generate_golden_lean_fixture.py --profile filter --output "$fixture"

run_segment() {
  local name="$1" start="$2" end="$3" checkpoint="${4:-}"
  local checkpoint_args=()
  if [[ -n "$checkpoint" ]]; then checkpoint_args=(--checkpoint "$checkpoint"); fi
  PYTHONPATH=src ruletrade_python scripts/generate_composable_semantic_lean.py \
    --output "$work/$name/Main.cs" --start-date "$start" --end-date "$end" "${checkpoint_args[@]}"
  PYTHONPATH=src ruletrade_python scripts/run_lean_backtest.py \
    --source "$work/$name/Main.cs" --output-dir "$work/$name" --dataset-id filter-synthetic
}

run_segment continuous 2024-01-02 2024-01-19
run_segment segment-1 2024-01-02 2024-01-09
PYTHONPATH=src ruletrade_python scripts/export_temporal_checkpoint.py \
  --log "$work/segment-1/lean.log" --cutoff 2024-01-09 --output "$work/checkpoint-1.json"
run_segment segment-2 2024-01-10 2024-01-19 "$work/checkpoint-1.json"
PYTHONPATH=src ruletrade_python scripts/verify_composable_restart_e2e.py \
  --continuous-log "$work/continuous/lean.log" \
  --segment-log "$work/segment-1/lean.log" --segment-log "$work/segment-2/lean.log" \
  --checkpoint "$work/checkpoint-1.json"
