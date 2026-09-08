from __future__ import annotations

from ruletrade.strategy.v1.models import CanonicalStrategyV1


GOLDEN_PORTFOLIO_PAYLOAD = {
    "metadata": {
        "name": "Growth 70 / Safe 30",
        "description": "Deterministic per-event growth selection with a stable safe sleeve.",
    },
    "random_seed": 123,
    "definitions": {
        "asset_sets": [
            {"id": "growth", "assets": ["QQQ", "VGT", "SOXX", "SCHG"]},
            {"id": "safe", "assets": ["TLT", "IEF"]},
        ]
    },
    "graph": {
        "components": [
            {"id": "monthly", "primitive": "monthly@1", "config": {"day": 1}},
            {
                "id": "growth_assets",
                "primitive": "asset_set@1",
                "config": {"asset_set_ref": "growth"},
            },
            {
                "id": "growth_random",
                "primitive": "random_select@1",
                "config": {"count": 2, "resample": "per_event"},
            },
            {
                "id": "growth_weights",
                "primitive": "equal_weight@1",
                "config": {"total": "0.70"},
            },
            {
                "id": "safe_assets",
                "primitive": "asset_set@1",
                "config": {"asset_set_ref": "safe"},
            },
            {
                "id": "safe_weights",
                "primitive": "equal_weight@1",
                "config": {"total": "0.30"},
            },
            {"id": "targets", "primitive": "merge_targets@1"},
            {"id": "rebalance", "primitive": "rebalance@1"},
        ],
        "connections": [
            {
                "source": {"component_id": "growth_assets", "port": "assets"},
                "target": {"component_id": "growth_random", "port": "assets"},
            },
            {
                "source": {"component_id": "growth_random", "port": "selected"},
                "target": {"component_id": "growth_weights", "port": "assets"},
            },
            {
                "source": {"component_id": "growth_weights", "port": "targets"},
                "target": {"component_id": "targets", "port": "left"},
            },
            {
                "source": {"component_id": "safe_assets", "port": "assets"},
                "target": {"component_id": "safe_weights", "port": "assets"},
            },
            {
                "source": {"component_id": "safe_weights", "port": "targets"},
                "target": {"component_id": "targets", "port": "right"},
            },
            {
                "source": {"component_id": "targets", "port": "targets"},
                "target": {"component_id": "rebalance", "port": "targets"},
            },
        ],
    },
    "entrypoints": [
        {"event_component_id": "monthly", "target_component_id": "rebalance"}
    ],
}


GOLDEN_STATEFUL_RULE_PAYLOAD = {
    "metadata": {
        "name": "Five-step buy",
        "description": "Buy one QQQ share while a persistent counter is below five.",
    },
    "definitions": {
        "state": [{"id": "buy_count", "value_type": "integer", "initial": 0}]
    },
    "graph": {
        "components": [
            {"id": "monthly", "primitive": "monthly@1", "config": {"day": 1}},
            {
                "id": "buy_rule",
                "primitive": "rule@1",
                "condition": {
                    "kind": "comparison",
                    "operator": "lt",
                    "left": {"kind": "state_ref", "state_id": "buy_count"},
                    "right": {"kind": "literal", "value_type": "integer", "value": 5},
                },
                "actions": [
                    {
                        "kind": "buy",
                        "asset": {"kind": "literal", "value_type": "asset", "value": "QQQ"},
                        "quantity": {"kind": "literal", "value_type": "shares", "value": "1"},
                    },
                    {
                        "kind": "increment_state",
                        "state_id": "buy_count",
                        "amount": {"kind": "literal", "value_type": "integer", "value": 1},
                    },
                ],
            },
        ]
    },
    "entrypoints": [
        {"event_component_id": "monthly", "target_component_id": "buy_rule"}
    ],
}


MOMENTUM_TOP_N_PAYLOAD = {
    "metadata": {
        "name": "Trailing Return Top 2",
        "description": "Select the two strongest assets by 126-bar trailing return.",
    },
    "definitions": {
        "asset_sets": [
            {"id": "universe", "assets": ["QQQ", "VGT", "SOXX", "SCHG"]},
        ]
    },
    "graph": {
        "components": [
            {"id": "monthly", "primitive": "monthly@1", "config": {"day": 1}},
            {
                "id": "universe_assets",
                "primitive": "asset_set@1",
                "config": {"asset_set_ref": "universe"},
            },
            {
                "id": "momentum",
                "primitive": "trailing_return@1",
                "config": {"lookback_bars": 126},
            },
            {
                "id": "momentum_rank",
                "primitive": "rank@1",
                "config": {"direction": "descending"},
            },
            {"id": "top_n", "primitive": "top_n@1", "config": {"count": 2}},
            {
                "id": "weights",
                "primitive": "equal_weight@1",
                "config": {"total": "1.0"},
            },
            {"id": "rebalance", "primitive": "rebalance@1"},
        ],
        "connections": [
            {"source": {"component_id": "universe_assets", "port": "assets"}, "target": {"component_id": "momentum", "port": "assets"}},
            {"source": {"component_id": "momentum", "port": "scores"}, "target": {"component_id": "momentum_rank", "port": "scores"}},
            {"source": {"component_id": "momentum_rank", "port": "ranked"}, "target": {"component_id": "top_n", "port": "ranked"}},
            {"source": {"component_id": "top_n", "port": "selected"}, "target": {"component_id": "weights", "port": "assets"}},
            {"source": {"component_id": "weights", "port": "targets"}, "target": {"component_id": "rebalance", "port": "targets"}},
        ],
    },
    "entrypoints": [{"event_component_id": "monthly", "target_component_id": "rebalance"}],
}


FILTER_SCREENING_PAYLOAD = {
    "metadata": {
        "name": "Positive Trailing Return Top 2",
        "description": "Screen for positive 126-bar trailing return, then select the top two.",
    },
    "definitions": {
        "asset_sets": [
            {"id": "universe", "assets": ["QQQ", "VGT", "SOXX", "SCHG"]},
        ]
    },
    "graph": {
        "components": [
            {"id": "monthly", "primitive": "monthly@1", "config": {"day": 1}},
            {
                "id": "universe_assets",
                "primitive": "asset_set@1",
                "config": {"asset_set_ref": "universe"},
            },
            {
                "id": "momentum",
                "primitive": "trailing_return@1",
                "config": {"lookback_bars": 126},
            },
            {
                "id": "positive_return",
                "primitive": "filter@1",
                "config": {"operator": "gt", "threshold": "0"},
            },
            {
                "id": "momentum_rank",
                "primitive": "rank@1",
                "config": {"direction": "descending"},
            },
            {"id": "top_n", "primitive": "top_n@1", "config": {"count": 2}},
            {
                "id": "weights",
                "primitive": "equal_weight@1",
                "config": {"total": "1.0"},
            },
            {"id": "rebalance", "primitive": "rebalance@1"},
        ],
        "connections": [
            {"source": {"component_id": "universe_assets", "port": "assets"}, "target": {"component_id": "momentum", "port": "assets"}},
            {"source": {"component_id": "momentum", "port": "scores"}, "target": {"component_id": "positive_return", "port": "scores"}},
            {"source": {"component_id": "positive_return", "port": "scores"}, "target": {"component_id": "momentum_rank", "port": "scores"}},
            {"source": {"component_id": "momentum_rank", "port": "ranked"}, "target": {"component_id": "top_n", "port": "ranked"}},
            {"source": {"component_id": "top_n", "port": "selected"}, "target": {"component_id": "weights", "port": "assets"}},
            {"source": {"component_id": "weights", "port": "targets"}, "target": {"component_id": "rebalance", "port": "targets"}},
        ],
    },
    "entrypoints": [{"event_component_id": "monthly", "target_component_id": "rebalance"}],
}


def golden_portfolio_strategy() -> CanonicalStrategyV1:
    return CanonicalStrategyV1.model_validate(GOLDEN_PORTFOLIO_PAYLOAD)


def golden_stateful_rule_strategy() -> CanonicalStrategyV1:
    return CanonicalStrategyV1.model_validate(GOLDEN_STATEFUL_RULE_PAYLOAD)


def momentum_top_n_strategy() -> CanonicalStrategyV1:
    return CanonicalStrategyV1.model_validate(MOMENTUM_TOP_N_PAYLOAD)


def filter_screening_strategy() -> CanonicalStrategyV1:
    return CanonicalStrategyV1.model_validate(FILTER_SCREENING_PAYLOAD)
