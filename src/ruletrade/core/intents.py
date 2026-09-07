from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class RebalanceIntent:
    target_weights: dict[str, Decimal]
