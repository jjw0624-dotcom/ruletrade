#!/usr/bin/env bash
set -euo pipefail

mode="${1:-core}"
if [[ "$mode" != "core" && "$mode" != "real-data" && "$mode" != "all" ]]; then
  echo "usage: $0 [core|real-data|all]" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

mkdir -p .acceptance/mvp
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_file=".acceptance/mvp/automated-${mode}-${timestamp}.log"
exec > >(tee "$log_file") 2>&1

echo "RuleTrade MVP WSL acceptance"
echo "mode=$mode"
echo "head=$(git rev-parse HEAD)"
echo "branch=$(git branch --show-current)"
echo "started_utc=$timestamp"
echo "kernel=$(uname -srmo)"

if ! grep -qi microsoft /proc/version; then
  echo "warning: this host does not identify itself as WSL; continuing with the same contracts" >&2
fi

command -v git >/dev/null
command -v uv >/dev/null
command -v npm >/dev/null
command -v docker >/dev/null
docker info >/dev/null

run_core() {
  if command -v google-chrome >/dev/null; then
    export CHROME_BIN=google-chrome
  elif command -v google-chrome-stable >/dev/null; then
    export CHROME_BIN=google-chrome-stable
  elif [[ -z "${CHROME_BIN:-}" ]]; then
    echo "Chrome is required. Install google-chrome or set CHROME_BIN." >&2
    return 1
  fi

  make bootstrap
  make check
  make check-lean
  make check-lean-persisted-v2-api
  node scripts/check_builder_browser.mjs
}

run_real_data() {
  if [[ -z "${RULETRADE_LEAN_DATA_DIR:-}" ]]; then
    echo "RULETRADE_LEAN_DATA_DIR must point to an operator-provisioned LEAN data directory." >&2
    return 2
  fi
  if [[ ! -d "$RULETRADE_LEAN_DATA_DIR" ]]; then
    echo "RULETRADE_LEAN_DATA_DIR is not a directory: $RULETRADE_LEAN_DATA_DIR" >&2
    return 2
  fi

  ./scripts/inspect_market_data.sh QQQ SCHG SOXX VGT
  ./scripts/run_real_market_data_smoke.sh --symbol QQQ
  ./scripts/run_real_market_data_e2e.sh
}

case "$mode" in
  core)
    run_core
    ;;
  real-data)
    run_real_data
    ;;
  all)
    run_core
    run_real_data
    ;;
esac

echo "completed_utc=$(date -u +%Y%m%dT%H%M%SZ)"
echo "PASS: automated $mode acceptance"
echo "log=$log_file"
