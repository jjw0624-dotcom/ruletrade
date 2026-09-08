#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"

image="${RULETRADE_LEAN_IMAGE:-quantconnect/lean:latest}"
fixture="$repo_root/tests/fixtures/lean-data"
work="$repo_root/build/lean/e2e"
log="$work/lean.log"
results="$work/results"
container_id=""

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$repo_root"
scripts/build_golden_lean_docker.sh

for symbol in qqq vgt soxx schg tlt ief; do
  if [[ ! -f "$fixture/equity/usa/daily/$symbol.zip" ]]; then
    echo "Missing synthetic LEAN fixture: equity/usa/daily/$symbol.zip" >&2
    exit 1
  fi
done
if [[ ! -f "$fixture/alternative/interest-rate/usa/interest-rate.csv" ]]; then
  echo "Missing synthetic LEAN interest-rate fixture." >&2
  exit 1
fi

mkdir -p "$work"
rm -rf "$results"
mkdir -p "$results"
: > "$log"

container_id="$(docker create \
  --workdir /Lean/Launcher/bin/Debug \
  --entrypoint dotnet \
  "$image" \
  QuantConnect.Lean.Launcher.dll \
  --algorithm-type-name RuleTradeGeneratedAlgorithm \
  --algorithm-language CSharp \
  --algorithm-location /Lean/Launcher/bin/Debug/RuleTradeGenerated.dll \
  --data-folder /Lean/Data \
  --results-destination-folder /Lean/Results)"

docker cp "$repo_root/build/lean/bin/RuleTradeGenerated.dll" \
  "$container_id:/Lean/Launcher/bin/Debug/RuleTradeGenerated.dll"
docker cp "$fixture/." "$container_id:/Lean/Data/"

docker start --attach "$container_id" | tee "$log"
docker cp "$container_id:/Lean/Results/." "$results/"

mapfile -t result_files < <(
  find "$results" -type f -name '*.json' \
    ! -name '*-order-events.json' \
    ! -name '*-summary.json' \
    ! -name '*-insights.json' \
    | sort
)
if [[ "${#result_files[@]}" -ne 1 ]]; then
  echo "Expected exactly one LEAN result JSON, found ${#result_files[@]}." >&2
  exit 1
fi

PYTHONPATH=src ruletrade_python scripts/verify_lean_e2e.py \
  --log "$log" \
  --result "${result_files[0]}"
