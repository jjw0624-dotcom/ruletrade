#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RULETRADE_LEAN_DATA_DIR:-}" ]]; then
  echo "RULETRADE_LEAN_DATA_DIR must point to a licensed LEAN data directory." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
cd "$repo_root"

database="${1:-$repo_root/build/lean/real-market-data-e2e/ruletrade.sqlite3}"
mkdir -p "$(dirname "$database")"

PYTHONPATH=src ruletrade_python scripts/run_candidate_comparison_lean_e2e.py \
  --database "$database" \
  --dataset-id us-equity-daily-local \
  --start-date 2024-01-01 \
  --end-date 2024-12-31
