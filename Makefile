.PHONY: install test validate backtest api smoke

install:
	python -m pip install -e ".[bt,dev]"

test:
	python -m pytest

validate:
	python -m ruletrade.cli validate examples/monthly_dca.yaml

backtest:
	python -m ruletrade.cli backtest examples/monthly_dca.yaml --dataset synthetic_prices --data-dir data

api:
	uvicorn ruletrade.api:app --reload

smoke:
	./scripts/smoke_test.sh
