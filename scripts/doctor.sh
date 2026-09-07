#!/usr/bin/env bash

set -u

OUT=${1:-ruletrade-diagnostic.txt}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$PROJECT_ROOT/.venv/bin/python"

exec > >(tee "$OUT") 2>&1

printf '%s\n' '=== RuleTrade environment ==='
uname -a || true

printf '%s\n' '=== Project Python ==='

if [ ! -x "$PYTHON" ]; then
    printf 'ERROR: project virtual environment not found at %s\n' "$PYTHON"
    printf '%s\n' 'Run: uv sync --extra bt --extra dev'
    exit 1
fi

"$PYTHON" --version
printf 'python=%s\n' "$PYTHON"

if command -v uv >/dev/null 2>&1; then
    uv --version
else
    printf '%s\n' 'uv NOT_ON_PATH (not required once .venv exists)'
fi

printf '%s\n' '=== Optional Docker environment ==='

if command -v docker >/dev/null 2>&1; then
    docker --version || true

    if docker compose version >/dev/null 2>&1; then
        docker compose version || true
    else
        printf '%s\n' 'docker_compose NOT_AVAILABLE'
    fi
else
    printf '%s\n' 'docker NOT_INSTALLED (optional for current MVP)'
fi

printf '%s\n' '=== Python packages ==='

"$PYTHON" - <<'PY'
import importlib
import importlib.metadata

for name in [
    "ruletrade-mvp",
    "bt",
    "pydantic",
    "fastapi",
    "pandas",
    "numpy",
]:
    try:
        print(name, importlib.metadata.version(name))
    except importlib.metadata.PackageNotFoundError:
        print(name, "NOT_INSTALLED")

try:
    importlib.import_module("bt")
    print("bt_import", "OK")
except Exception as exc:
    print("bt_import", "FAILED", repr(exc))
PY

printf '%s\n' '=== Unit and integration tests ==='

"$PYTHON" -m pytest
TEST_STATUS=$?

printf '%s\n' '=== Strategy validation ==='

"$PYTHON" -m ruletrade.cli validate examples/monthly_dca.yaml
VALIDATE_STATUS=$?

printf '%s\n' '=== End-to-end backtest ==='

"$PYTHON" -m ruletrade.cli backtest \
    examples/monthly_dca.yaml \
    --dataset synthetic_prices \
    --data-dir data \
    > /tmp/ruletrade-result.json

BACKTEST_STATUS=$?

if [ "$BACKTEST_STATUS" -eq 0 ]; then
    "$PYTHON" - <<'PY'
import json

with open("/tmp/ruletrade-result.json", encoding="utf-8") as handle:
    result = json.load(handle)

print(json.dumps(result["metrics"], indent=2))
print("cashflow_count", len(result["cashflows"]))
print("transaction_count", len(result["transactions"]))
PY
fi

printf '%s\n' '=== Status summary ==='

printf 'tests=%s validate=%s backtest=%s\n' \
    "$TEST_STATUS" \
    "$VALIDATE_STATUS" \
    "$BACKTEST_STATUS"

printf 'diagnostic_file=%s\n' "$OUT"

if [ "$TEST_STATUS" -ne 0 ] \
    || [ "$VALIDATE_STATUS" -ne 0 ] \
    || [ "$BACKTEST_STATUS" -ne 0 ]; then
    exit 1
fi
