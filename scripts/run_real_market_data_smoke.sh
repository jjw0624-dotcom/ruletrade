#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RULETRADE_LEAN_DATA_DIR:-}" ]]; then
  echo "RULETRADE_LEAN_DATA_DIR must point to a LEAN-compatible data directory." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
cd "$repo_root"

PYTHONPATH=src ruletrade_python scripts/run_real_market_data_smoke.py "$@"
