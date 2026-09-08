#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
image="${RULETRADE_LEAN_IMAGE:-quantconnect/lean:latest}"
source_path="${1:-build/lean/Main.cs}"
output_path="${2:-build/lean/bin}"
host_uid="$(id -u)"
host_gid="$(id -g)"

cd "$repo_root"
if [[ "$#" -eq 0 ]]; then
  PYTHONPATH=src ruletrade_python scripts/generate_golden_lean.py
fi

case "$source_path:$output_path" in
  build/lean/*:build/lean/*) ;;
  *)
    echo "LEAN source and output must remain below build/lean/." >&2
    exit 2
    ;;
esac

docker run --rm \
  --user "$host_uid:$host_gid" \
  --env HOME=/tmp \
  --env DOTNET_CLI_HOME=/tmp \
  --entrypoint dotnet \
  --volume "$repo_root:/workspace" \
  --workdir /workspace \
  "$image" \
  build tools/lean/RuleTrade.Generated.csproj \
  --configuration Release \
  --output "/workspace/$output_path" \
  "-p:GeneratedSource=/workspace/$source_path" \
  "-p:BaseIntermediateOutputPath=/tmp/ruletrade-obj/"
