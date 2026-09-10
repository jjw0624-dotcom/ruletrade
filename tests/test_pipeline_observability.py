from __future__ import annotations

import sqlite3
from pathlib import Path

from ruletrade.backtests.models import BacktestDiagnostics, BacktestTimings
from ruletrade.diagnostics import serialized_bytes
from ruletrade.hashing import strategy_hash
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import filter_screening_strategy


def test_zero_duration_diagnostics_are_valid_and_deterministic() -> None:
    timings = BacktestTimings()
    diagnostics = BacktestDiagnostics()

    assert set(timings.model_dump().values()) == {0}
    assert set(diagnostics.model_dump().values()) == {0}
    assert serialized_bytes(diagnostics) == serialized_bytes(BacktestDiagnostics())


def test_diagnostics_do_not_affect_canonical_hash_or_semantics() -> None:
    canonical = filter_screening_strategy()
    before = canonical.model_dump(mode="json")
    source_hash = strategy_hash(canonical)

    _diagnostics = BacktestDiagnostics(
        canonical_bytes=serialized_bytes(canonical),
        generated_csharp_bytes=1234,
        evidence_events=12,
    )

    assert canonical.model_dump(mode="json") == before
    assert strategy_hash(canonical) == source_hash


def test_latest_previous_schema_adds_diagnostics_without_changing_sources(
    tmp_path: Path,
) -> None:
    database = tmp_path / "schema-v6.sqlite3"
    strategies = StrategyService(SQLiteStrategyRepository(database))
    created = strategies.create_strategy("Migration sentinel", filter_screening_strategy())
    expected_revision = created.current_revision

    with sqlite3.connect(database) as connection:
        connection.execute("ALTER TABLE backtest_runs DROP COLUMN diagnostics_json")
        connection.execute("ALTER TABLE candidates DROP COLUMN diagnostics_json")
        connection.execute("ALTER TABLE comparisons DROP COLUMN diagnostics_json")
        connection.execute("PRAGMA user_version = 6")

    reopened = StrategyService(SQLiteStrategyRepository(database))

    assert reopened.get_revision_by_id(expected_revision.id) == expected_revision
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 8
        for table in ("backtest_runs", "candidates", "comparisons"):
            columns = {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})")
            }
            assert "diagnostics_json" in columns
