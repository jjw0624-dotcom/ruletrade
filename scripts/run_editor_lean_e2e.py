from __future__ import annotations

import argparse
import json

from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.backtests.models import LeanBacktestRequest
from ruletrade.backtests.service import BacktestService
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the editor Canonical-to-LEAN service path")
    parser.add_argument("--random-count", type=int, default=3)
    args = parser.parse_args()

    strategy = golden_portfolio_strategy()
    components = list(strategy.graph.components)
    index = next(index for index, item in enumerate(components) if item.id == "growth_random")
    components[index] = components[index].model_copy(
        update={"config": {"count": args.random_count, "resample": "per_event"}}
    )
    strategy = strategy.model_copy(
        update={"graph": strategy.graph.model_copy(update={"components": tuple(components)})}
    )
    response = BacktestService(DockerLeanRunner()).execute(LeanBacktestRequest(strategy=strategy))
    print(json.dumps(response.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    main()
