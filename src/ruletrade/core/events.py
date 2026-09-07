from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class RebalanceEvent:
    occurred_at: datetime
    event_id: str
