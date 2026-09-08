#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"
image="${RULETRADE_LEAN_IMAGE:-quantconnect/lean:latest}"

cd "$repo_root"
PYTHONPATH=src ruletrade_python scripts/generate_golden_lean.py

docker run --rm \
  --entrypoint /bin/bash \
  --volume "$repo_root:/workspace" \
  --workdir /workspace \
  "$image" \
  -lc 'dotnet build tools/lean/RuleTrade.Generated.csproj --configuration Release --output build/lean/bin'
