#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/lib/ruletrade_python.sh"

mkdir -p "$repo_root/build/lean"
work="$(mktemp -d "$repo_root/build/lean/momentum-compile-XXXXXX")"
trap 'rm -rf "$work"' EXIT

cd "$repo_root"
relative_work="${work#"$repo_root/"}"
PYTHONPATH=src ruletrade_python scripts/generate_momentum_lean.py \
  --output "$relative_work/Main.cs"
"$repo_root/scripts/build_golden_lean_docker.sh" \
  "$relative_work/Main.cs" \
  "$relative_work/bin"
test -f "$work/bin/RuleTradeGenerated.dll"
