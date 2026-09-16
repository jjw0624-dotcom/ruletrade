#!/usr/bin/env bash
set -euo pipefail

mode="${1:-full}"
if [[ "$mode" != "fast" && "$mode" != "full" ]]; then
  echo "usage: $0 [fast|full]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

uv run pytest
npm --prefix frontend run generate:bootstrap
npm --prefix frontend run test:raw
npm --prefix frontend run typecheck:raw

if [[ "$mode" == "fast" ]]; then
  exit 0
fi

npm --prefix frontend run build:raw
./scripts/check_ruff.sh
uv run python -m compileall -q src scripts tests

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(find scripts -maxdepth 1 -type f -name '*.sh' -print0)

git diff --check
git diff --exit-code -- \
  frontend/src/test/generated-momentum-bootstrap.json \
  frontend/src/test/generated-sleeves-bootstrap.json \
  frontend/src/test/generated-cooldown-bootstrap.json
