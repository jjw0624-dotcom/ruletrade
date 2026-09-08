#!/usr/bin/env bash

ruletrade_python() {
  if [[ -n "${RULETRADE_PYTHON:-}" ]]; then
    "${RULETRADE_PYTHON}" "$@"
  elif command -v uv >/dev/null 2>&1; then
    uv run python "$@"
  elif command -v python3 >/dev/null 2>&1; then
    python3 "$@"
  else
    echo "RuleTrade requires uv, python3, or RULETRADE_PYTHON=/path/to/python." >&2
    return 127
  fi
}
