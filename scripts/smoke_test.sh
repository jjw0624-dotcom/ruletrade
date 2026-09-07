#!/usr/bin/env bash
set -euo pipefail

python -m pytest
python -m ruletrade.cli validate examples/monthly_dca.yaml
python -m ruletrade.cli backtest examples/monthly_dca.yaml --dataset synthetic_prices --data-dir data > /tmp/ruletrade-result.json
python - <<'PY'
import json
with open('/tmp/ruletrade-result.json', encoding='utf-8') as handle:
    result = json.load(handle)
print(json.dumps(result['metrics'], indent=2))
assert result['metrics']['final_value'] > 0
assert len(result['cashflows']) >= 12
PY
