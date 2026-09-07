from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "synthetic_prices.csv"


def main() -> None:
    rng = np.random.default_rng(20260903)
    dates = pd.bdate_range("2022-01-03", "2025-12-31")
    qqq_returns = 0.00045 + 0.012 * rng.standard_normal(len(dates))
    voo_returns = 0.00030 + 0.008 * rng.standard_normal(len(dates))

    shock = (dates >= "2022-04-01") & (dates <= "2022-06-30")
    qqq_returns[shock] -= 0.0015
    voo_returns[shock] -= 0.0008

    qqq = 100.0 * np.exp(np.cumsum(qqq_returns))
    voo = 100.0 * np.exp(np.cumsum(voo_returns))
    frame = pd.DataFrame({"date": dates, "QQQ": qqq, "VOO": voo})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(OUTPUT, index=False, float_format="%.8f")
    print(OUTPUT)


if __name__ == "__main__":
    main()
