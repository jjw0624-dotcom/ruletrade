#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
work="$repo_root/build/lean/temporal-reliability-e2e"
fixture="$repo_root/build/lean/lean-temporal-data"
cd "$repo_root"
rm -rf "$work" "$fixture"
mkdir -p "$work"

PYTHONPATH=src ruletrade_python scripts/generate_golden_lean_fixture.py --profile temporal --output "$fixture"

run_segment() {
  local name="$1"
  local start="$2"
  local end="$3"
  local checkpoint="${4:-}"
  local checkpoint_args=()
  if [[ -n "$checkpoint" ]]; then
    checkpoint_args=(--checkpoint "$checkpoint")
  fi
  PYTHONPATH=src ruletrade_python scripts/generate_temporal_stateful_lean.py \
    --output "$work/$name/Main.cs" --start-date "$start" --end-date "$end" \
    "${checkpoint_args[@]}"
  PYTHONPATH=src ruletrade_python scripts/run_lean_backtest.py \
    --source "$work/$name/Main.cs" --output-dir "$work/$name" --dataset-id temporal-synthetic
}

run_segment continuous 2024-01-02 2024-01-12
run_segment segment-1 2024-01-02 2024-01-03
PYTHONPATH=src ruletrade_python scripts/export_temporal_checkpoint.py \
  --log "$work/segment-1/lean.log" --cutoff 2024-01-03 --output "$work/checkpoint-1.json"
run_segment segment-2 2024-01-04 2024-01-04 "$work/checkpoint-1.json"
PYTHONPATH=src ruletrade_python scripts/export_temporal_checkpoint.py \
  --log "$work/segment-2/lean.log" --cutoff 2024-01-04 --output "$work/checkpoint-2.json"
run_segment segment-3 2024-01-05 2024-01-08 "$work/checkpoint-2.json"
PYTHONPATH=src ruletrade_python scripts/export_temporal_checkpoint.py \
  --log "$work/segment-3/lean.log" --cutoff 2024-01-08 --output "$work/checkpoint-3.json"
run_segment segment-4 2024-01-09 2024-01-12 "$work/checkpoint-3.json"

PYTHONPATH=src ruletrade_python scripts/verify_temporal_restart_e2e.py \
  --continuous-log "$work/continuous/lean.log" \
  --segment-log "$work/segment-1/lean.log" \
  --segment-log "$work/segment-2/lean.log" \
  --segment-log "$work/segment-3/lean.log" \
  --segment-log "$work/segment-4/lean.log" \
  --checkpoint "$work/checkpoint-1.json" \
  --checkpoint "$work/checkpoint-2.json" \
  --checkpoint "$work/checkpoint-3.json"

