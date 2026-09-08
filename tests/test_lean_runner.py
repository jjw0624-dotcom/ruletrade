from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from ruletrade.backtests.errors import LeanExecutionError, MalformedLeanResultError
from ruletrade.backtests.lean_runner import (
    LEAN_ALGORITHM_ID,
    DockerLeanRunner,
    load_lean_backtest_result,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_result_discovery_uses_explicit_lean_algorithm_id_with_multiple_json_files(
    tmp_path: Path,
) -> None:
    expected = {"statistics": {"Total Orders": "51"}, "charts": {}}
    _write_json(tmp_path / f"{LEAN_ALGORITHM_ID}.json", expected)
    _write_json(tmp_path / f"{LEAN_ALGORITHM_ID}-summary.json", {"statistics": {}})
    _write_json(tmp_path / f"{LEAN_ALGORITHM_ID}-order-events.json", [])
    _write_json(tmp_path / LEAN_ALGORITHM_ID / "alpha-results.json", [])
    _write_json(tmp_path / "config.json", {"algorithm-type-name": "not a result"})

    assert load_lean_backtest_result(tmp_path) == expected


def test_result_discovery_reports_missing_full_result_and_observed_files(tmp_path: Path) -> None:
    _write_json(tmp_path / f"{LEAN_ALGORITHM_ID}-summary.json", {})
    _write_json(tmp_path / "config.json", {})

    with pytest.raises(MalformedLeanResultError) as error:
        load_lean_backtest_result(tmp_path)

    message = str(error.value)
    assert f"{LEAN_ALGORITHM_ID}.json" in message
    assert "config.json" in message
    assert f"{LEAN_ALGORITHM_ID}-summary.json" in message


def test_result_discovery_rejects_ambiguous_full_results(tmp_path: Path) -> None:
    _write_json(tmp_path / "first" / f"{LEAN_ALGORITHM_ID}.json", {})
    _write_json(tmp_path / "second" / f"{LEAN_ALGORITHM_ID}.json", {})

    with pytest.raises(MalformedLeanResultError, match="ambiguous") as error:
        load_lean_backtest_result(tmp_path)

    assert "first/" in str(error.value)
    assert "second/" in str(error.value)


@pytest.mark.parametrize("contents", ["not-json", "[]"])
def test_result_discovery_rejects_malformed_full_result(tmp_path: Path, contents: str) -> None:
    (tmp_path / f"{LEAN_ALGORITHM_ID}.json").write_text(contents, encoding="utf-8")

    with pytest.raises(MalformedLeanResultError):
        load_lean_backtest_result(tmp_path)


class _FakeDocker:
    def __init__(self, repo_root: Path, *, fail_build: bool = False) -> None:
        self.repo_root = repo_root
        self.fail_build = fail_build
        self.work_directories: list[Path] = []
        self.container_number = 0

    def __call__(
        self, arguments: list[str], *, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        if arguments[0].endswith("build_golden_lean_docker.sh"):
            work = (self.repo_root / arguments[1]).parent
            self.work_directories.append(work)
            if self.fail_build:
                raise LeanExecutionError("simulated build failure")
            binary = self.repo_root / arguments[2]
            binary.mkdir(parents=True, exist_ok=True)
            (binary / "RuleTradeGenerated.dll").write_bytes(b"fake")
        elif arguments[:2] == ["docker", "create"]:
            self.container_number += 1
            return subprocess.CompletedProcess(arguments, 0, f"container-{self.container_number}\n", "")
        elif arguments[:3] == ["docker", "start", "--attach"]:
            log = f"Algorithm Id:({LEAN_ALGORITHM_ID}) completed in 1.0 seconds\n"
            return subprocess.CompletedProcess(arguments, 0, log, "")
        elif arguments[:2] == ["docker", "cp"] and arguments[2].endswith("/Lean/Results/."):
            results = Path(arguments[3])
            _write_json(results / f"{LEAN_ALGORITHM_ID}.json", {"statistics": {}})
            _write_json(results / f"{LEAN_ALGORITHM_ID}-summary.json", {})
            _write_json(results / LEAN_ALGORITHM_ID / "alpha-results.json", [])
            _write_json(results / "config.json", {})
        return subprocess.CompletedProcess(arguments, 0, "", "")


def _runner_with_fake_docker(repo_root: Path, fake: _FakeDocker) -> DockerLeanRunner:
    fixture = repo_root / "tests" / "fixtures" / "lean-data"
    fixture.mkdir(parents=True)
    runner = DockerLeanRunner(repo_root=repo_root)
    runner._ensure_runtime = lambda: None  # type: ignore[method-assign]
    runner._run = fake  # type: ignore[method-assign]
    return runner


def test_sequential_runs_are_isolated_and_cleaned(tmp_path: Path) -> None:
    fake = _FakeDocker(tmp_path)
    runner = _runner_with_fake_docker(tmp_path, fake)

    first = runner.run("// first", dataset_id="golden-synthetic")
    second = runner.run("// second", dataset_id="golden-synthetic")

    assert first.result_payload == {"statistics": {}}
    assert second.result_payload == {"statistics": {}}
    assert len(set(fake.work_directories)) == 2
    assert list((tmp_path / "build" / "lean" / "runs").iterdir()) == []


def test_failed_build_still_cleans_run_directory(tmp_path: Path) -> None:
    fake = _FakeDocker(tmp_path, fail_build=True)
    runner = _runner_with_fake_docker(tmp_path, fake)

    with pytest.raises(LeanExecutionError, match="simulated build failure"):
        runner.run("// build fails", dataset_id="golden-synthetic")

    assert list((tmp_path / "build" / "lean" / "runs").iterdir()) == []


def test_docker_build_keeps_intermediates_off_host_and_maps_user() -> None:
    script = (
        Path(__file__).parents[1] / "scripts" / "build_golden_lean_docker.sh"
    ).read_text(encoding="utf-8")

    assert '--user "$host_uid:$host_gid"' in script
    assert "-p:BaseIntermediateOutputPath=/tmp/ruletrade-obj/" in script
    assert "BaseIntermediateOutputPath=/workspace/" not in script


def test_failed_subprocess_preserves_diagnostics_without_exposing_them_in_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    diagnostic = "Main.cs(12,41): error CS0246: RollingWindow<> could not be found"

    def fail(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(["docker", "run"], 1, "build started", diagnostic)

    monkeypatch.setattr(subprocess, "run", fail)
    runner = DockerLeanRunner(repo_root=tmp_path)

    with pytest.raises(LeanExecutionError) as error:
        runner._run(["docker", "run"])

    assert str(error.value) == "LEAN process failed (run)."
    assert error.value.diagnostic_output is not None
    assert "CS0246" in error.value.diagnostic_output
    assert "build started" in error.value.diagnostic_output
    assert "CS0246" in caplog.text
