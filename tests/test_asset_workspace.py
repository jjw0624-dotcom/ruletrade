from datetime import date

from ruletrade.asset_workspace import AssetCompareRequest, AssetResearchService
from ruletrade.datasets import DatasetRegistry
from ruletrade.strategy.v1.fixtures import fallback_momentum_strategy


def service(tmp_path):
    source = __import__("pathlib").Path(__file__).parents[1] / "data" / "synthetic_prices.csv"
    (tmp_path / "synthetic_prices.csv").write_bytes(source.read_bytes())
    return AssetResearchService(DatasetRegistry(tmp_path))


def test_asset_search_and_strategy_membership_are_real(tmp_path):
    item = service(tmp_path).list_assets("synthetic_prices", "qqq")[0]
    assert item.symbol == "QQQ"
    detail = service(tmp_path).detail("QQQ", "synthetic_prices", date(2024, 12, 31), strategy=fallback_momentum_strategy())
    assert any(item.kind in {"asset_set", "universe"} for item in detail.memberships)
    assert detail.series[-1].date <= detail.as_of


def test_point_in_time_never_uses_future_observations(tmp_path):
    research = service(tmp_path)
    earlier = research.detail("QQQ", "synthetic_prices", date(2023, 6, 30), lookback_observations=5)
    later = research.detail("QQQ", "synthetic_prices", date(2024, 6, 30), lookback_observations=5)
    assert earlier.series[-1].date <= date(2023, 6, 30)
    assert all(point.date <= date(2023, 6, 30) for point in earlier.series)
    assert earlier.metrics[0].value != later.metrics[0].value


def test_compare_is_bounded_and_uses_one_as_of(tmp_path):
    result = service(tmp_path).compare(AssetCompareRequest(
        symbols=("QQQ", "VOO"), as_of=date(2024, 12, 31), lookback_observations=5
    ))
    assert [item.asset.symbol for item in result.items] == ["QQQ", "VOO"]
    assert all(item.series[-1].date <= result.as_of for item in result.items)
    assert all(item.metrics[1].status == "available" for item in result.items)
