from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from ruletrade.backtests.errors import (
    LeanExecutionError,
    LeanRuntimeUnavailableError,
    MalformedLeanResultError,
)

LEAN_ALGORITHM_ID = "RuleTradeGeneratedAlgorithm"
_MAX_DIAGNOSTIC_CHARACTERS = 20_000
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LeanRunArtifact:
    log_text: str
    result_payload: dict[str, Any]


class LeanRunner(Protocol):
    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact: ...


def load_lean_backtest_result(
    results_directory: Path,
    *,
    algorithm_id: str = LEAN_ALGORITHM_ID,
) -> dict[str, Any]:
    """Load LEAN's full backtest result using its ``{AlgorithmId}.json`` contract."""
    expected_name = f"{algorithm_id}.json"
    result_files = sorted(
        path for path in results_directory.rglob(expected_name) if path.is_file()
    )
    observed_json = sorted(
        path.relative_to(results_directory).as_posix()
        for path in results_directory.rglob("*.json")
        if path.is_file()
    )
    if not result_files:
        observed = ", ".join(observed_json) if observed_json else "none"
        raise MalformedLeanResultError(
            f"LEAN full result {expected_name!r} was not found; observed JSON files: {observed}."
        )
    if len(result_files) > 1:
        matches = ", ".join(
            path.relative_to(results_directory).as_posix() for path in result_files
        )
        raise MalformedLeanResultError(
            f"LEAN full result {expected_name!r} is ambiguous; matching files: {matches}."
        )
    try:
        payload = json.loads(result_files[0].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MalformedLeanResultError(
            f"LEAN full result {expected_name!r} could not be read."
        ) from exc
    if not isinstance(payload, dict):
        raise MalformedLeanResultError(f"LEAN full result {expected_name!r} is not an object.")
    return payload


class DockerLeanRunner:
    """Compile and run compiler-generated C# using the repository's LEAN image path."""

    def __init__(self, *, repo_root: Path | None = None, timeout_seconds: int = 900) -> None:
        self.repo_root = repo_root or Path(__file__).resolve().parents[3]
        self.timeout_seconds = timeout_seconds
        self.image = os.getenv("RULETRADE_LEAN_IMAGE", "quantconnect/lean:latest")

    def _run(self, arguments: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        try:
            completed = subprocess.run(
                arguments,
                cwd=self.repo_root,
                text=True,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise LeanExecutionError("LEAN process could not complete.") from exc
        if check and completed.returncode != 0:
            output_parts = []
            if completed.stdout.strip():
                output_parts.append(f"stdout:\n{completed.stdout.strip()}")
            if completed.stderr.strip():
                output_parts.append(f"stderr:\n{completed.stderr.strip()}")
            diagnostic_output = "\n".join(output_parts)
            if len(diagnostic_output) > _MAX_DIAGNOSTIC_CHARACTERS:
                diagnostic_output = (
                    "[earlier subprocess output truncated]\n"
                    + diagnostic_output[-_MAX_DIAGNOSTIC_CHARACTERS:]
                )
            if diagnostic_output:
                logger.error("LEAN subprocess failed:\n%s", diagnostic_output)
            raise LeanExecutionError(
                f"LEAN process failed ({arguments[1] if len(arguments) > 1 else 'docker'}).",
                diagnostic_output=diagnostic_output or None,
            )
        return completed

    def _ensure_runtime(self) -> None:
        if shutil.which("docker") is None:
            raise LeanRuntimeUnavailableError("Docker is not installed or is not on PATH.")
        try:
            completed = subprocess.run(
                ["docker", "version", "--format", "{{.Server.Version}}"],
                cwd=self.repo_root,
                text=True,
                capture_output=True,
                timeout=15,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise LeanRuntimeUnavailableError("Docker runtime is unavailable.") from exc
        if completed.returncode != 0:
            raise LeanRuntimeUnavailableError("Docker daemon is unavailable.")

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        fixture_names = {
            "golden-synthetic": "lean-data",
            "filter-synthetic": "lean-filter-data",
            "cooldown-synthetic": "lean-cooldown-data",
        }
        if dataset_id not in fixture_names:
            raise LeanExecutionError(f"Unsupported LEAN dataset: {dataset_id}")
        self._ensure_runtime()
        fixture = self.repo_root / "tests" / "fixtures" / fixture_names[dataset_id]
        if not fixture.is_dir():
            raise LeanExecutionError("Synthetic LEAN fixture is missing.")

        runs_root = self.repo_root / "build" / "lean" / "runs"
        runs_root.mkdir(parents=True, exist_ok=True)
        container_id: str | None = None
        with tempfile.TemporaryDirectory(prefix="run-", dir=runs_root) as temporary:
            work = Path(temporary)
            source = work / "Main.cs"
            binary = work / "bin"
            results = work / "results"
            source.write_text(generated_csharp, encoding="utf-8")
            binary.mkdir()
            results.mkdir()
            relative_work = work.relative_to(self.repo_root).as_posix()

            try:
                self._run(
                    [
                        str(self.repo_root / "scripts" / "build_golden_lean_docker.sh"),
                        f"{relative_work}/Main.cs",
                        f"{relative_work}/bin",
                    ]
                )
                created = self._run(
                    [
                        "docker", "create", "--workdir", "/Lean/Launcher/bin/Debug",
                        "--entrypoint", "dotnet", self.image,
                        "QuantConnect.Lean.Launcher.dll",
                        "--algorithm-type-name", "RuleTradeGeneratedAlgorithm",
                        "--algorithm-language", "CSharp",
                        "--algorithm-id", LEAN_ALGORITHM_ID,
                        "--algorithm-location", "/Lean/Launcher/bin/Debug/RuleTradeGenerated.dll",
                        "--data-folder", "/Lean/Data",
                        "--results-destination-folder", "/Lean/Results",
                    ]
                )
                container_id = created.stdout.strip()
                if not container_id:
                    raise LeanExecutionError("Docker did not return a LEAN container id.")
                self._run(
                    [
                        "docker",
                        "cp",
                        str(binary / "RuleTradeGenerated.dll"),
                        f"{container_id}:/Lean/Launcher/bin/Debug/RuleTradeGenerated.dll",
                    ]
                )
                self._run(["docker", "cp", f"{fixture}/.", f"{container_id}:/Lean/Data/"])
                execution = self._run(["docker", "start", "--attach", container_id], check=False)
                log_text = execution.stdout + execution.stderr
                if execution.returncode != 0:
                    raise LeanExecutionError("LEAN Launcher failed.")
                lowered = log_text.casefold()
                fatal_patterns = (
                    "error::",
                    "runtime error",
                    "algorithm.runtimeerror",
                    "algorithm state changed",
                    "unhandled exception",
                    "the security does not have an accurate price",
                )
                if any(pattern in lowered for pattern in fatal_patterns):
                    raise LeanExecutionError("LEAN reported a runtime error.")
                completion = re.search(
                    (
                        r"algorithm id:.*completed|"
                        r"algorithmmanager\.run\(\): firing on end of algorithm|"
                        r"backtest completed"
                    ),
                    log_text,
                    re.IGNORECASE,
                )
                if completion is None:
                    raise LeanExecutionError("LEAN completion marker was not found.")
                self._run(["docker", "cp", f"{container_id}:/Lean/Results/.", str(results)])
                payload = load_lean_backtest_result(results)
                return LeanRunArtifact(log_text=log_text, result_payload=payload)
            finally:
                if container_id:
                    try:
                        self._run(["docker", "rm", "--force", container_id], check=False)
                    except LeanExecutionError:
                        pass
