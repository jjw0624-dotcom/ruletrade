.PHONY: bootstrap install test check-fast check check-lean check-lean-generate validate backtest api frontend smoke

bootstrap:
	uv sync --extra bt --extra dev --locked
	cd frontend && npm ci --no-audit --no-fund

install: bootstrap

test:
	uv run pytest

check-fast:
	./scripts/check.sh fast

check:
	./scripts/check.sh full

check-lean:
	./scripts/check_lean.sh

check-lean-generate:
	./scripts/check_lean.sh --generate-only

validate:
	python -m ruletrade.cli validate examples/monthly_dca.yaml

backtest:
	python -m ruletrade.cli backtest examples/monthly_dca.yaml --dataset synthetic_prices --data-dir data

api:
	uv run uvicorn ruletrade.api:app --reload

frontend:
	cd frontend && npm run dev

smoke:
	./scripts/smoke_test.sh
