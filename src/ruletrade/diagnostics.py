from __future__ import annotations

import json
from time import perf_counter_ns

from pydantic import BaseModel


def elapsed_ms(started_ns: int) -> int:
    """Return a non-negative monotonic elapsed duration in integer milliseconds."""

    return max(0, (perf_counter_ns() - started_ns) // 1_000_000)


def serialized_bytes(value: BaseModel | object) -> int:
    """Measure compact product JSON without changing its semantic representation."""

    payload = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    return len(
        json.dumps(
            payload,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )
