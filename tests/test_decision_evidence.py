from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi.testclient import TestClient

from ruletrade.api import app, get_lean_backtest_service
from ruletrade.backtest_runs.errors import BacktestRunPersistenceError
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import LeanRunArtifact
from ruletrade.backtests.models import BacktestConfig
from ruletrade.backtests.service import BacktestService
from ruletrade.decision_evidence import collect_decision_evidence
from ruletrade.persistence import SQLiteBacktestRunRepository, SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def _record(sequence: int, session: str, phase: str, kind: str, **fields: str) -> str:
    values = {
        "sequence": str(sequence),
        "session": session,
        "phase": phase,
        "kind": kind,
        **fields,
    }
    return "RULETRADE_EVIDENCE_V1|" + "|".join(
        f"{quote(key, safe='')}={quote(value, safe='')}" for key, value in values.items()
    )


def representative_log() -> str:
    records = [
        _record(
            1,
            "2024-04-01",
            "evaluation",
            "filter",
            filter_component="positive_filter",
            operator="gt",
            threshold="0",
            scores="QQQ=0.12,VGT=-0.067",
            eligible="QQQ",
            rejected="VGT",
        ),
        _record(
            2,
            "2024-04-01",
            "selection",
            "selection",
            score_component="trailing_return",
            rank_component="rank",
            selection_component="top_n",
            scores="QQQ=0.12,VGT=-0.067",
            ranked="QQQ",
            candidates="QQQ",
            primary_selected="",
            decision="insufficient",
        ),
        _record(
            3,
            "2024-04-01",
            "selection",
            "fallback",
            fallback_component="fallback",
            asset="TLT",
            activated="true",
        ),
        _record(
            4,
            "2024-04-01",
            "selection",
            "final_selection",
            selection_component="fallback",
            selected="TLT",
            source="fallback",
        ),
        _record(
            5,
            "2024-04-01",
            "snapshot_commit",
            "snapshot_refresh",
            sleeve_component="growth_sleeve",
            schedule="monthly",
            local_targets="TLT=1",
            snapshot_session="2024-04-01",
        ),
        _record(
            6,
            "2024-04-02",
            "portfolio_execution",
            "snapshot_usage",
            schedule_component="quarterly",
            schedule="quarterly",
            snapshots="growth_sleeve=2024-04-01",
            executed="true",
        ),
        _record(
            7,
            "2024-04-02",
            "portfolio_execution",
            "sleeve_contribution",
            sleeve_component="growth_sleeve",
            local_selected="TLT",
            local_targets="TLT=1",
            allocation="0.7",
            scaled_targets="TLT=0.7",
        ),
        _record(
            8,
            "2024-04-02",
            "selection",
            "cooldown",
            cooldown_component="cooldown",
            asset="QQQ",
            signal_candidate="true",
            last_exit="2024-03-15",
            elapsed_sessions="12",
            required_sessions="20",
            eligible="false",
        ),
        _record(
            9,
            "2024-04-02",
            "state_mutation",
            "state_mutation",
            state_component="cooldown",
            asset="QQQ",
            state="last_exit",
            old_value="none",
            new_value="2024-04-02",
            cause="target_exit",
        ),
        _record(
            10,
            "2024-04-02",
            "portfolio_execution",
            "final_targets",
            rebalance_component="rebalance",
            selected="TLT",
            targets="TLT=0.7",
        ),
    ]
    return "DEBUG:: existing human traces remain independent\n" + "\n".join(records)


def golden_log() -> str:
    return "\n".join(
        (
            _record(
                1,
                "2024-01-02",
                "selection",
                "random_selection",
                selection_component="growth_random",
                universe="QQQ,VGT,SOXX,SCHG",
                selected="QQQ,VGT",
                resample="per_event",
            ),
            _record(
                2,
                "2024-01-02",
                "portfolio_execution",
                "final_targets",
                rebalance_component="rebalance",
                selected="IEF,QQQ,TLT,VGT",
                targets="IEF=0.15,QQQ=0.35,TLT=0.15,VGT=0.35",
            ),
        )
    )


def _result_payload() -> dict[str, Any]:
    return {
        "statistics": {
            "Start Equity": "100000",
            "End Equity": "110000",
            "Net Profit": "10%",
            "Total Orders": "2",
            "Total Fees": "$1",
        },
        "charts": {
            "Strategy Equity": {
                "series": {"Equity": {"values": [[1704153600, 100000], [1735603200, 110000]]}}
            }
        },
    }


@dataclass
class EvidenceRunner:
    log_text: str = field(default_factory=golden_log)
    calls: int = 0

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls += 1
        return LeanRunArtifact(log_text=self.log_text, result_payload=_result_payload())


def _services(
    database: Path,
    runner: EvidenceRunner | None = None,
    repository: SQLiteBacktestRunRepository | None = None,
) -> tuple[StrategyService, BacktestRunService]:
    strategies = StrategyService(SQLiteStrategyRepository(database))
    return strategies, BacktestRunService(
        repository or SQLiteBacktestRunRepository(database),
        strategies,
        BacktestService(runner or EvidenceRunner()),
    )


def test_machine_contract_preserves_why_why_not_and_semantic_boundaries() -> None:
    events = collect_decision_evidence(representative_log())

    assert [item.sequence for item in events] == list(range(1, 11))
    rejected = events[0].evidence
    assert rejected.kind == "filter"
    assert [(item.asset, item.passed) for item in rejected.evaluations] == [
        ("QQQ", True),
        ("VGT", False),
    ]
    selection = events[1].evidence
    assert selection.kind == "selection"
    assert selection.candidates == ("QQQ",)
    assert selection.primary_selected == ()
    assert events[2].evidence.kind == "fallback"
    assert events[3].evidence.kind == "final_selection"
    assert events[4].phase == "snapshot_commit"
    assert events[5].evidence.snapshots["growth_sleeve"].isoformat() == "2024-04-01"
    assert events[6].evidence.scaled_targets["TLT"] == (
        events[6].evidence.local_targets["TLT"] * events[6].evidence.allocation
    )
    cooldown = events[7].evidence
    assert cooldown.signal_candidate and not cooldown.eligible
    assert cooldown.elapsed_completed_sessions == 12
    assert cooldown.required_completed_sessions == 20
    assert events[8].evidence.state == "last_exit"
    assert events[9].evidence.targets == {"TLT": Decimal("0.7")}
    assert all(item.source_components for item in events)


def test_successful_run_persists_ordered_versioned_evidence_and_reopens(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    runner = EvidenceRunner()
    strategies, service = _services(database, runner)
    revision = strategies.create_strategy("Evidence", golden_portfolio_strategy()).current_revision

    run = service.create_and_execute(revision.id, BacktestConfig())
    summaries = service.list_decision_events(run.id)
    detail = service.get_decision_event(run.id, summaries[0].id)

    assert run.status.value == "succeeded"
    assert len(summaries) == 2
    assert [item.ordinal for item in summaries] == [1, 2]
    assert all(item.run_id == run.id and item.schema_version == 1 for item in summaries)
    assert detail.evidence.kind == "random_selection"

    reopened_runner = EvidenceRunner()
    _strategies, reopened = _services(database, reopened_runner)
    assert reopened.list_decision_events(run.id) == summaries
    assert reopened.get_decision_event(run.id, detail.id) == detail
    assert reopened_runner.calls == 0


def test_failed_run_has_no_partial_evidence(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, service = _services(database, EvidenceRunner(log_text="Backtest completed"))
    revision = strategies.create_strategy("No evidence", golden_portfolio_strategy()).current_revision

    run = service.create_and_execute(revision.id, BacktestConfig())

    assert run.status.value == "failed"
    assert run.error is not None and run.error.code == "evidence_collection_failure"
    assert service.list_decision_events(run.id) == ()


def test_unknown_source_component_provenance_fails_run(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    invalid = golden_log().replace(
        "rebalance_component=rebalance", "rebalance_component=unknown"
    )
    strategies, service = _services(database, EvidenceRunner(log_text=invalid))
    revision = strategies.create_strategy("Bad provenance", golden_portfolio_strategy()).current_revision

    run = service.create_and_execute(revision.id, BacktestConfig())

    assert run.status.value == "failed"
    assert run.error is not None and run.error.code == "evidence_collection_failure"
    assert service.list_decision_events(run.id) == ()


class FailingEvidenceRepository(SQLiteBacktestRunRepository):
    def complete_succeeded_with_evidence(self, *args: Any, **kwargs: Any):
        raise BacktestRunPersistenceError("injected evidence failure")


def test_evidence_persistence_failure_cannot_claim_run_success(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    repository = FailingEvidenceRepository(database)
    strategies, service = _services(database, repository=repository)
    revision = strategies.create_strategy("Failure", golden_portfolio_strategy()).current_revision

    run = service.create_and_execute(revision.id, BacktestConfig())

    assert run.status.value == "failed"
    assert run.error is not None and run.error.code == "evidence_persistence_failure"
    assert service.list_decision_events(run.id) == ()


def test_decision_event_api_lists_lightweight_summaries_and_reads_detail(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, service = _services(database)
    revision = strategies.create_strategy("API", golden_portfolio_strategy()).current_revision
    run = service.create_and_execute(revision.id, BacktestConfig())
    app.dependency_overrides[get_lean_backtest_service] = lambda: service
    try:
        with TestClient(app) as client:
            listed = client.get(f"/v1/backtest-runs/{run.id}/decision-events")
            assert listed.status_code == 200
            item = listed.json()["items"][0]
            assert "evidence" not in item
            detail = client.get(
                f"/v1/backtest-runs/{run.id}/decision-events/{item['id']}"
            )
            assert detail.status_code == 200
            assert detail.json()["evidence"]["kind"] == "random_selection"
            assert client.get(
                f"/v1/backtest-runs/{run.id}/decision-events/missing"
            ).json()["detail"]["code"] == "decision_event_not_found"
            assert client.get(
                "/v1/backtest-runs/missing/decision-events"
            ).json()["detail"]["code"] == "run_not_found"
    finally:
        app.dependency_overrides.clear()


def test_database_schema_and_evidence_rows_are_immutable(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, service = _services(database)
    revision = strategies.create_strategy("Schema", golden_portfolio_strategy()).current_revision
    run = service.create_and_execute(revision.id, BacktestConfig())
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
        row = connection.execute(
            """
            SELECT schema_version, evidence_json
            FROM decision_events WHERE run_id = ? ORDER BY ordinal LIMIT 1
            """,
            (run.id,),
        ).fetchone()
        assert row[0] == 1 and json.loads(row[1])["kind"] == "random_selection"
        try:
            connection.execute(
                "UPDATE decision_events SET phase = 'changed' WHERE run_id = ?", (run.id,)
            )
        except sqlite3.IntegrityError as exc:
            assert "immutable derived artifacts" in str(exc)
        else:
            raise AssertionError("Decision Event update unexpectedly succeeded")
        try:
            connection.execute(
                """
                INSERT INTO decision_events (
                    run_id, id, ordinal, schema_version, session_id, phase, kind,
                    source_components_json, evidence_json
                ) VALUES (?, 'late', 999, 1, '2024-01-02', 'selection',
                    'random_selection', '[]', '{}')
                """,
                (run.id,),
            )
        except sqlite3.IntegrityError as exc:
            assert "running run" in str(exc)
        else:
            raise AssertionError("Evidence was attached after Run completion")


def test_schema_v2_database_migrates_without_changing_historical_runs(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, service = _services(database)
    revision = strategies.create_strategy("Before v3", golden_portfolio_strategy()).current_revision
    run = service.create_and_execute(revision.id, BacktestConfig())
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER decision_events_no_update")
        connection.execute("DROP TRIGGER decision_events_no_delete")
        connection.execute("DROP TRIGGER decision_events_running_run_only")
        connection.execute("DROP TABLE decision_events")
        connection.execute("PRAGMA user_version = 2")

    _strategies, reopened = _services(database)

    assert reopened.get_run(run.id) == run
    assert reopened.list_decision_events(run.id) == ()
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
