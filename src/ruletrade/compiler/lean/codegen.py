from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal

from ruletrade.compiler.lean.plan import (
    LeanDailyEvent,
    LeanMomentumSelection,
    LeanPlan,
    LeanQuarterlyEvent,
    LeanRandomSelection,
    LeanSnapshotAllocation,
    LeanTemporalCondition,
    LeanTemporalCheckpoint,
    LeanTemporalEvent,
    LeanTemporalValue,
    LeanValue,
    normalize_lean_plan,
)


@dataclass(frozen=True)
class CSharpGenerationSettings:
    algorithm_class: str = "RuleTradeGeneratedAlgorithm"
    start_date: date = date(2024, 1, 1)
    end_date: date = date(2024, 12, 31)
    initial_cash: Decimal = Decimal("100000")
    snapshot_id: str = "unspecified"
    temporal_checkpoint: LeanTemporalCheckpoint | None = None


def _csharp_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def _filter_condition(selection: LeanMomentumSelection, value: str) -> str:
    clauses = selection.filter_clauses
    if not clauses and selection.filter_operator is not None and selection.filter_threshold is not None:
        from ruletrade.compiler.lean.plan import LeanFilterClause
        clauses = (LeanFilterClause(selection.filter_operator, selection.filter_threshold),)
    operators = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    return " && ".join(f"{value} {operators[item.operator]} {_decimal_literal(item.threshold)}" for item in clauses) or "true"


def _ranking_method(selection: LeanMomentumSelection) -> str:
    return "OrderByDescending" if selection.direction == "descending" else "OrderBy"


def _filter_operator(selection: LeanMomentumSelection) -> str:
    return selection.filter_clauses[0].operator if selection.filter_clauses else (selection.filter_operator or "gt")


def _filter_field(selection: LeanMomentumSelection) -> str:
    return "condition" if selection.filter_clauses else "config.threshold"


def _filter_clause_evidence(selection: LeanMomentumSelection) -> str:
    clauses = selection.filter_clauses
    if not clauses and selection.filter_operator is not None and selection.filter_threshold is not None:
        from ruletrade.compiler.lean.plan import LeanFilterClause
        clauses = (LeanFilterClause(selection.filter_operator, selection.filter_threshold),)
    return ",".join(f"{item.operator}:{item.threshold}" for item in clauses)


def _selection_success(selection: LeanMomentumSelection, variable: str) -> str:
    return f"{variable}.Count > 0" if selection.shortage_policy == "choose_all" else f"{variable}.Count == {selection.count}"


def _decimal_literal(value: Decimal) -> str:
    literal = f"{format(value.normalize(), 'f')}m"
    # Member access binds before unary minus in C#. Parenthesize negative literals
    # so both arithmetic use and generated ``literal.ToString(...)`` remain numeric.
    return f"({literal})" if value < 0 else literal


def _value_observations(value: LeanValue | None) -> int:
    if value is None or value.kind == "literal":
        return 0
    if value.kind == "current_price":
        return 1
    if value.kind == "trailing_return":
        return int(value.observations or 0) + 1
    if value.kind == "rolling_price":
        return int(value.observations or 0)
    if value.kind == "weighted_score":
        return max((_value_observations(term.value) for term in value.score_terms), default=0)
    return _value_observations(value.operand)


def _value_assets(value: LeanValue | None) -> set[str]:
    if value is None:
        return set()
    assets = {value.asset} if value.subject == "asset" and value.asset else set()
    assets.update(_value_assets(value.operand))
    for term in value.score_terms:
        assets.update(_value_assets(term.value))
    return assets


def _value_csharp(value: LeanValue, candidate: str) -> str:
    ticker = candidate if value.subject == "candidate" else _csharp_string(value.asset or "")
    if value.kind == "literal":
        return f"(decimal?){_decimal_literal(value.literal or Decimal(0))}"
    if value.kind == "current_price":
        return f"CurrentPrice({ticker})"
    if value.kind == "trailing_return":
        return f"TrailingReturn({ticker}, {value.observations})"
    if value.kind == "rolling_price":
        return f"RollingPrice({ticker}, {value.observations}, {_csharp_string(value.aggregate or 'mean')})"
    if value.kind == "scale" and value.operand is not None:
        return f"ScaleValue({_value_csharp(value.operand, candidate)}, {_decimal_literal(value.factor or Decimal(0))})"
    if value.kind == "weighted_score":
        values = ", ".join(_value_csharp(term.value, candidate) for term in value.score_terms)
        weights = ", ".join(_decimal_literal(term.weight) for term in value.score_terms)
        clamp_min = "null" if value.clamp_min is None else _decimal_literal(value.clamp_min)
        clamp_max = "null" if value.clamp_max is None else _decimal_literal(value.clamp_max)
        return (
            f"WeightedScore(new decimal?[] {{ {values} }}, new decimal[] {{ {weights} }}, "
            f"{_csharp_string(value.missing_policy or 'require_all')}, "
            f"{_csharp_string(value.normalization or 'none')}, {clamp_min}, {clamp_max})"
        )
    raise ValueError(f"unsupported LEAN value: {value.kind}")


def _comparison_csharp(comparison, candidate: str) -> str:
    operators = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    left = _value_csharp(comparison.left, candidate)
    right = _value_csharp(comparison.right, candidate)
    return f"CompareValues({left}, {right}, {_csharp_string(operators[comparison.operator])})"


def _ranking_value(selection) -> LeanValue:
    return selection.ranking_value or LeanValue(
        kind="trailing_return", value_type="percentage", subject="candidate",
        observations=selection.lookback_bars,
    )


def _uses_legacy_trailing_return(selection: LeanMomentumSelection) -> bool:
    value = _ranking_value(selection)
    return (
        value.kind == "trailing_return"
        and value.subject == "candidate"
        and value.observations == selection.lookback_bars
    )


def _eligibility_condition(selection: LeanMomentumSelection, comparison) -> str:
    operators = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    if (
        comparison.left == _ranking_value(selection)
        and comparison.right.kind == "literal"
        and comparison.right.literal is not None
    ):
        return (
            f"item.Value {operators[comparison.operator]} "
            f"{_decimal_literal(comparison.right.literal)}"
        )
    return _comparison_csharp(comparison, "item.Key")


def _uses_legacy_predicate(rebalance) -> bool:
    if rebalance.predicate is None or len(rebalance.condition) != 1:
        return False
    comparison = rebalance.condition[0]
    left, right, predicate = comparison.left, comparison.right, rebalance.predicate
    return (
        left.kind == "trailing_return"
        and left.subject == "asset"
        and left.asset == predicate.asset
        and left.observations == predicate.lookback_bars
        and right.kind == "literal"
        and right.literal == predicate.threshold
        and comparison.operator == predicate.operator
    )


def _value_json(value: LeanValue) -> str:
    return json.dumps(asdict(value), default=str, separators=(",", ":"), sort_keys=True)


def _temporal_value_csharp(value: LeanTemporalValue, variable: str) -> str:
    if value.kind == "current_price":
        return f"CurrentPrice({_csharp_string(value.asset or '')})"
    if value.kind == "literal":
        return f"(decimal?){_decimal_literal(value.literal or Decimal(0))}"
    if value.kind == "remembered":
        memory_id = _csharp_string(value.memory_id or "")
        return f"_memory.TryGetValue({memory_id}, out var {variable}MemoryValue) ? {variable}MemoryValue : (decimal?)null"
    if value.kind == "bars_since_event":
        event_id = _csharp_string(value.event_id or "")
        return f"_eventCutoffs.TryGetValue({event_id}, out var {variable}EventValueCutoff) ? (decimal?)(_boundaryIndex - {variable}EventValueCutoff) : null"
    if value.kind == "completed_weekly_price":
        return "_completedWeeklyClose"
    raise ValueError(f"unsupported temporal Value: {value.kind}")


def _temporal_condition_lines(condition: LeanTemporalCondition, prefix: str) -> tuple[str, ...]:
    operator = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "eq": "==", "neq": "!="}[condition.operator]
    lines = [
        f"        var {prefix}Left = {_temporal_value_csharp(condition.left, prefix + 'Left')};",
        f"        var {prefix}Right = {_temporal_value_csharp(condition.right, prefix + 'Right')};",
        f"        var {prefix}Ready = {prefix}Left.HasValue && {prefix}Right.HasValue;",
        f"        var {prefix}Truth = {prefix}Ready ? ({prefix}Left.Value {operator} {prefix}Right.Value ? \"true\" : \"false\") : \"unknown\";",
    ]
    if condition.required_state_key is not None:
        lines.extend((
            f"        var {prefix}StateTruth = StateEquals({_csharp_string(condition.required_state_key)}, {_csharp_string(condition.required_state_value or '')}) ? \"true\" : \"false\";",
            f"        {prefix}Truth = AllTruth({prefix}Truth, {prefix}StateTruth);",
        ))
    if condition.after_event_id is not None:
        event_id = _csharp_string(condition.after_event_id)
        window = int(condition.within_observations or 0)
        lines.extend((
            f"        var {prefix}WindowTruth = _eventCutoffs.TryGetValue({event_id}, out var {prefix}EventCutoff) ? (_boundaryIndex > {prefix}EventCutoff && _boundaryIndex - {prefix}EventCutoff <= {window} ? \"true\" : \"false\") : \"unknown\";",
            f"        {prefix}Truth = AllTruth({prefix}Truth, {prefix}WindowTruth);",
        ))
    return tuple(lines)


def _composable_policy_method_lines(plan: LeanPlan, target, index: int) -> tuple[str, ...]:
    """Generate a policy-local Selection → Allocation pipeline.

    The method consumes only typed plan nodes.  It deliberately contains no
    corpus/strategy-name branching, so every supported composition shares the
    same readiness, ranking, shortage, aggregation, and evidence semantics.
    """

    selections = {item.id: item for item in plan.momentum_selections}
    sleeves = {item.selection_id: item for item in plan.target_sleeves if item.selection_id}
    lines = [
        f"    private Dictionary<string, decimal> ComposablePolicy{index}(string eventIdentity)",
        "    {",
        "        var aggregate = new Dictionary<string, decimal>(StringComparer.Ordinal);",
    ]
    for leg_index, leg in enumerate(target.legs):
        factor = leg.weight if target.allocation_method == "fixed" else Decimal(1)
        if leg.target_kind == "asset":
            lines.extend((
                f"        aggregate[{_csharp_string(leg.target_ref or '')}] = aggregate.TryGetValue({_csharp_string(leg.target_ref or '')}, out var assetWeight{leg_index}) ? assetWeight{leg_index} + {_decimal_literal(factor or Decimal(0))} : {_decimal_literal(factor or Decimal(0))};",
            ))
            continue
        if leg.target_kind in {"cash", "retain"}:
            continue
        selection = selections.get(leg.target_ref or "")
        if selection is None:
            raise ValueError(f"composable policy references missing Selection {leg.target_ref!r}")
        sleeve = sleeves.get(selection.id)
        symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
        ranking = _value_csharp(_ranking_value(selection), "ticker")
        eligibility = (
            " && ".join(_eligibility_condition(selection, item) for item in selection.eligibility)
            or _filter_condition(selection, "item.Value")
        )
        order = _ranking_method(selection)
        success = _selection_success(selection, f"chosen{leg_index}")
        fallback = () if sleeve is None else sleeve.fallback_symbols
        fallback_items = ", ".join(_csharp_string(item) for item in fallback)
        lines.extend((
            f"        var scores{leg_index} = new Dictionary<string, decimal>(StringComparer.Ordinal);",
            f"        foreach (var ticker in new[] {{ {symbols} }})",
            "        {",
            f"            var observed = {ranking};",
            f"            if (observed.HasValue) scores{leg_index}[ticker] = observed.Value;",
            "        }",
            f"        var eligible{leg_index} = scores{leg_index}.Where(item => {eligibility}).ToList();",
            f"        var ranked{leg_index} = eligible{leg_index}.{order}(item => item.Value).ThenBy(item => item.Key, StringComparer.Ordinal).ToList();",
            f"        var chosen{leg_index} = ranked{leg_index}.Take({selection.count}).Select(item => item.Key).ToList();",
            f"        var primaryComplete{leg_index} = {success};",
            f"        if (!primaryComplete{leg_index}) chosen{leg_index} = new List<string> {{ {fallback_items} }};",
            '        EmitDecisionEvidence(eventIdentity, "selection_fallback", "selection",',
            f'            "selection_id", {_csharp_string(selection.id)}, "ranked", EvidenceRanks(ranked{leg_index}.Select(item => item.Key)),',
            f'            "selected", string.Join(",", chosen{leg_index}), "primary_complete", primaryComplete{leg_index} ? "true" : "false",',
            f'            "fallback", primaryComplete{leg_index} ? "false" : "true");',
        ))
        if target.allocation_method == "proportional_score":
            lines.extend((
                f"        var positiveTotal{leg_index} = chosen{leg_index}.Where(item => scores{leg_index}.ContainsKey(item)).Sum(item => Math.Max(0m, scores{leg_index}[item]));",
                f"        foreach (var ticker in chosen{leg_index})",
                "        {",
                f"            var localWeight = primaryComplete{leg_index} && positiveTotal{leg_index} > 0m ? Math.Max(0m, scores{leg_index}[ticker]) / positiveTotal{leg_index} : (chosen{leg_index}.Count == 0 ? 0m : 1m / chosen{leg_index}.Count);",
                f"            var weight = localWeight * {_decimal_literal(factor or Decimal(0))};",
                f"            aggregate[ticker] = aggregate.TryGetValue(ticker, out var existing{leg_index}) ? existing{leg_index} + weight : weight;",
                "        }",
            ))
        else:
            lines.extend((
                f"        foreach (var ticker in chosen{leg_index})",
                "        {",
                f"            var weight = (chosen{leg_index}.Count == 0 ? 0m : 1m / chosen{leg_index}.Count) * {_decimal_literal(factor or Decimal(0))};",
                f"            aggregate[ticker] = aggregate.TryGetValue(ticker, out var existing{leg_index}) ? existing{leg_index} + weight : weight;",
                "        }",
            ))
    lines.extend((
        '        EmitDecisionEvidence(eventIdentity, "allocation_aggregation", "allocation", "policy_id", ' + _csharp_string(target.semantic_id) + ',',
        '            "method", ' + _csharp_string(target.allocation_method) + ', "weights", string.Join(",", aggregate.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))));',
        "        return aggregate;",
        "    }",
        "",
    ))
    return tuple(lines)


def _temporal_method_lines(
    plan: LeanPlan, settings: CSharpGenerationSettings,
) -> tuple[str, ...]:
    temporal = plan.temporal_program
    if temporal is None:
        return ()
    lines: list[str] = [
        "    private bool StateEquals(string key, string expected)",
        "    {",
        "        return _state.TryGetValue(key, out var value) && value == expected;",
        "    }",
        "",
        "    private static string AllTruth(string left, string right)",
        "    {",
        '        if (left == "false" || right == "false") return "false";',
        '        if (left == "unknown" || right == "unknown") return "unknown";',
        '        return "true";',
        "    }",
        "",
    ]
    for index, target in enumerate(temporal.policy_targets):
        if target.target_kind == "portfolio":
            lines.extend(_composable_policy_method_lines(plan, target, index))
    lines.extend([
        "    private void ExecuteTemporalBoundary(string cutoff)",
        "    {",
        "        _boundaryIndex++;",
        f'        var eventIdentity = {_csharp_string(temporal.clock_id)} + ":" + cutoff;',
        '        EmitDecisionEvidence(eventIdentity, "observation", "boundary", "clock", '
        f'{_csharp_string(temporal.clock_id)}, "cutoff", cutoff, "boundary_index", _boundaryIndex.ToString(CultureInfo.InvariantCulture));',
    ])
    for index, event in enumerate(temporal.events):
        prefix = f"temporal{index}"
        lines.extend(_temporal_condition_lines(event.condition, prefix))
        event_id = _csharp_string(event.semantic_id)
        trigger = (
            f'{prefix}Truth == "true"'
            if event.trigger == "while_true"
            else f'{prefix}Truth == "true" && {prefix}Previous != "true"'
            if event.trigger in {"rising_edge", "crosses_above"}
            else f'{prefix}Truth == "false" && {prefix}Previous == "true"'
        )
        lines.extend((
            f"        var {prefix}Previous = _eventTruth.TryGetValue({event_id}, out var {prefix}PriorTruth) ? {prefix}PriorTruth : \"false\";",
            f"        var {prefix}Triggered = {trigger};",
            f"        _eventTruth[{event_id}] = {prefix}Truth;",
            f"        if ({prefix}Triggered)",
            "        {",
            f"            var {prefix}Count = _eventCounts.TryGetValue({event_id}, out var {prefix}PriorCount) ? {prefix}PriorCount + 1 : 1;",
            f"            _eventCounts[{event_id}] = {prefix}Count;",
        ))
        if event.occurrence == "first":
            lines.append(f"            {prefix}Triggered = {prefix}Count == 1;")
        lines.extend((
            "        }",
            '        EmitDecisionEvidence(eventIdentity, "event_detection", "event",',
            f'            "event_id", {event_id}, "statement_id", {_csharp_string(event.statement_id)},',
            f'            "condition_id", {_csharp_string(event.condition.semantic_id)}, "status", {prefix}Truth == "unknown" ? "unknown" : "ready",',
            f'            "truth", {prefix}Truth,',
            f'            "previous_truth", {prefix}Previous, "triggered", {prefix}Triggered ? "true" : "false",',
            f'            "event_order", {_csharp_string(str(index))});',
            f"        if ({prefix}Triggered)",
            "        {",
            f"            _eventCutoffs[{event_id}] = _boundaryIndex;",
        ))
        for action_index, action in enumerate(event.actions):
            action_prefix = f"{prefix}Action{action_index}"
            if action.kind == "remember" and action.value is not None:
                lines.extend((
                    f"            var {action_prefix}Value = {_temporal_value_csharp(action.value, action_prefix)};",
                    f"            if ({action_prefix}Value.HasValue)",
                    "            {",
                    f"                _memory[{_csharp_string(action.memory_id or '')}] = {action_prefix}Value.Value;",
                    f"                _memoryCaptureCutoffs[{_csharp_string(action.memory_id or '')}] = _boundaryIndex;",
                    f"                _memoryValueIds[{_csharp_string(action.memory_id or '')}] = {_csharp_string(action.value.semantic_id)};",
                    '                EmitDecisionEvidence(eventIdentity, "memory_capture", "remember",',
                    f'                    "statement_id", {_csharp_string(action.semantic_id)}, "memory_id", {_csharp_string(action.memory_id or "")},',
                    f'                    "value_id", {_csharp_string(action.value.semantic_id)}, "capture_cutoff", cutoff,',
                    f'                    "value", {action_prefix}Value.Value.ToString("G29", CultureInfo.InvariantCulture));',
                    "            }",
                    "            else",
                    "            {",
                    '                EmitDecisionEvidence(eventIdentity, "memory_capture", "remember",',
                    f'                    "statement_id", {_csharp_string(action.semantic_id)}, "memory_id", {_csharp_string(action.memory_id or "")},',
                    '                    "status", "unknown");',
                    "            }",
                ))
            elif action.kind == "transition":
                key = _csharp_string(action.state_key or "")
                before = _csharp_string(action.from_value or "")
                after = _csharp_string(action.to_value or "")
                lines.extend((
                    f"            var {action_prefix}PreState = _state.TryGetValue({key}, out var {action_prefix}StateValue) ? {action_prefix}StateValue : \"\";",
                    f"            var {action_prefix}Selected = {action_prefix}PreState == {before};",
                    f"            if ({action_prefix}Selected)",
                    "            {",
                    f"                _state[{key}] = {after};",
                    f"                _stateEnteredCutoffs[{key}] = _boundaryIndex;",
                    "            }",
                    '            EmitDecisionEvidence(eventIdentity, "state_transition", "transition",',
                    f'                "statement_id", {_csharp_string(action.semantic_id)}, "state_key", {key},',
                    f'                "pre_state", {action_prefix}PreState, "selected", {action_prefix}Selected ? "true" : "false",',
                    f'                "post_state", {action_prefix}Selected ? {after} : {action_prefix}PreState, "event_id", {event_id});',
                ))
        lines.append("        }")

    lines.extend((
        '        var policyTarget = "retain";',
        '        var policyAsset = "";',
        '        var policyRule = "retain";',
        '        var policyWeights = new Dictionary<string, decimal>(StringComparer.Ordinal);',
    ))
    for index, target in enumerate(temporal.policy_targets):
        condition = (
            "true" if target.state_value == "*"
            else f"StateEquals({_csharp_string(target.state_key)}, {_csharp_string(target.state_value)})"
        )
        keyword = "if" if index == 0 else "else if"
        lines.extend((
            f"        {keyword} ({condition})",
            "        {",
            f"            policyTarget = {_csharp_string(target.target_kind)};",
            f"            policyAsset = {_csharp_string(target.asset or '')};",
            f"            policyRule = {_csharp_string(target.semantic_id)};",
            *(
                (f"            policyWeights = ComposablePolicy{index}(eventIdentity);",)
                if target.target_kind == "portfolio" else ()
            ),
            "        }",
        ))
    lines.extend((
        '        EmitDecisionEvidence(eventIdentity, "policy", "policy_decision", "rule_id", policyRule,',
        '            "target_kind", policyTarget, "asset", policyAsset, "weight", policyTarget == "retain" ? "" : "1",',
        '            "weights", string.Join(",", policyWeights.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
        '            "state", string.Join(",", _state.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value)));',
        '        var policySignature = policyTarget == "portfolio" ? "portfolio|" + string.Join(";", policyWeights.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))) : policyTarget + "|" + policyAsset;',
        "        if (policyTarget != \"retain\" && policySignature != _lastPolicyTarget)",
        "        {",
        "            if (policyTarget == \"asset\") SetHoldings(_symbols[policyAsset], 1m);",
        "            else if (policyTarget == \"cash\") Liquidate();",
        "            else if (policyTarget == \"portfolio\")",
        "            {",
        "                foreach (var holding in Portfolio.Where(item => item.Value.Invested && !policyWeights.ContainsKey(item.Key.Value)).ToList()) Liquidate(holding.Key);",
        "                foreach (var item in policyWeights) SetHoldings(_symbols[item.Key], item.Value);",
        "            }",
        '            EmitDecisionEvidence(eventIdentity, "order_intent", "target", "target_kind", policyTarget, "asset", policyAsset, "weight", "1",',
        '                "weights", string.Join(",", policyWeights.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))));',
        '            _lastPolicyTarget = policySignature;',
        "        }",
        '        EmitDecisionEvidence(eventIdentity, "checkpoint", "checkpoint",',
        f'            "schema_version", "ruletrade-temporal-checkpoint@1", "profile", {_csharp_string(temporal.profile)},',
        f'            "strategy_identity", {_csharp_string(plan.strategy_identity)}, "checkpoint_identity", {_csharp_string(temporal.checkpoint_identity)},',
        f'            "snapshot_id", {_csharp_string(settings.snapshot_id)}, "clock", {_csharp_string(temporal.clock_id)},',
        f'            "operator_versions", {_csharp_string(",".join(f"{key}={value}" for key, value in temporal.operator_versions))}, "cutoff", cutoff, "boundary_index", _boundaryIndex.ToString(CultureInfo.InvariantCulture),',
        f'            "asset_universe", {_csharp_string(",".join(temporal.asset_universe or (temporal.anchor_symbol,)))}, "statement_order", {_csharp_string(",".join((*[item.statement_id for item in temporal.events], temporal.policy_statement_id)))},',
        '            "state", string.Join(",", _state.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value)),',
        '            "events", string.Join(",", _eventCutoffs.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString(CultureInfo.InvariantCulture))),',
        '            "event_truths", string.Join(",", _eventTruth.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value)),',
        '            "event_counts", string.Join(",", _eventCounts.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString(CultureInfo.InvariantCulture))),',
        '            "state_entered_cutoffs", string.Join(",", _stateEnteredCutoffs.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString(CultureInfo.InvariantCulture))),',
        '            "memory", string.Join(",", _memory.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
        '            "memory_capture_cutoffs", string.Join(",", _memoryCaptureCutoffs.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString(CultureInfo.InvariantCulture))),',
        '            "memory_value_ids", string.Join(",", _memoryValueIds.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value)),',
        '            "last_policy_target", _lastPolicyTarget, "portfolio_target", _lastPolicyTarget,',
        '            "active_week_key", _activeWeekKey, "active_week_close", _activeWeekClose.HasValue ? _activeWeekClose.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
        '            "active_week_cutoff", _activeWeekCutoff, "completed_weekly_close", _completedWeeklyClose.HasValue ? _completedWeeklyClose.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
        '            "completed_weekly_source_cutoff", _completedWeeklySourceCutoff, "completed_weekly_available_cutoff", _completedWeeklyAvailableCutoff);',
        "    }",
        "",
        "    public override void OnOrderEvent(OrderEvent orderEvent)",
        "    {",
        "        if (orderEvent.Status != OrderStatus.Filled && orderEvent.Status != OrderStatus.PartiallyFilled) return;",
        '        EmitDecisionEvidence(Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), "orders", "order",',
        '            "order_id", orderEvent.OrderId.ToString(CultureInfo.InvariantCulture),',
        '            "symbol", orderEvent.Symbol.Value, "quantity", orderEvent.FillQuantity.ToString("G29", CultureInfo.InvariantCulture),',
        '            "price", orderEvent.FillPrice.ToString("G29", CultureInfo.InvariantCulture), "status", orderEvent.Status.ToString());',
        "    }",
        "",
    ))
    return tuple(lines)


def _condition_evidence_lines(comparisons, component_id: str, symbols: str, prefix: str) -> tuple[str, ...]:
    if not comparisons:
        return ()
    result = [f"        foreach (var evidenceTicker in new[] {{ {symbols} }})", "        {"]
    for index, comparison in enumerate(comparisons):
        left = f"{prefix}Left{index}"
        right = f"{prefix}Right{index}"
        outcome = f"{prefix}Outcome{index}"
        result.extend((
            f"            var {left} = {_value_csharp(comparison.left, 'evidenceTicker')};",
            f"            var {right} = {_value_csharp(comparison.right, 'evidenceTicker')};",
            f"            var {outcome} = CompareValues({left}, {right}, {_csharp_string({'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<='}[comparison.operator])});",
            '            EmitDecisionEvidence(eventIdentity, "evaluation", "value_condition",',
            f'                "eligibility_component", {_csharp_string(component_id)}, "eligibility_field", "condition",',
            f'                "subject", evidenceTicker, "operator", {_csharp_string(comparison.operator)},',
            f'                "left_definition", {_csharp_string(_value_json(comparison.left))}, "left_type", {_csharp_string(comparison.left.value_type)},',
            f'                "left_observed", {left}.HasValue ? {left}.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
            f'                "right_definition", {_csharp_string(_value_json(comparison.right))}, "right_type", {_csharp_string(comparison.right.value_type)},',
            f'                "right_observed", {right}.HasValue ? {right}.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
            f'                "outcome", {outcome} ? "true" : "false", "scope", "eligibility");',
        ))
    result.append("        }")
    return tuple(result)


def _seed_expression(plan: LeanPlan, selection: LeanRandomSelection) -> str:
    event_argument = "eventIdentity"
    if selection.resample == "once":
        event_argument = "null"
    return (
        "RuleTradeRandom.Seed("
        f"{_csharp_string(plan.strategy_identity)}, "
        f"{_csharp_string(selection.component_id)}, "
        f"{_csharp_string(selection.parameter_bindings_json)}, "
        f"{event_argument}, "
        f"{str(selection.resample == 'per_event').lower()})"
    )


def _random_helper_source() -> str:
    # This intentionally ports only the CPython operations used by
    # random.Random(seed).sample(pool, k): MT19937, getrandbits and _randbelow.
    return r"""
internal static class RuleTradeRandom
{
    public static ulong Seed(
        string strategyIdentity,
        string componentIdentity,
        string parameterBindingsJson,
        string eventIdentity,
        bool perEvent)
    {
        var eventPart = perEvent
            ? ",\"event_identity\":" + JsonSerializer.Serialize(eventIdentity)
            : "";
        var material = "{\"component_id\":" + JsonSerializer.Serialize(componentIdentity)
            + eventPart
            + ",\"parameter_bindings\":" + parameterBindingsJson
            + ",\"strategy\":" + JsonSerializer.Serialize(strategyIdentity) + "}";
        using (var sha = SHA256.Create())
        {
            var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(material));
            return ((ulong)digest[0] << 56) | ((ulong)digest[1] << 48)
                | ((ulong)digest[2] << 40) | ((ulong)digest[3] << 32)
                | ((ulong)digest[4] << 24) | ((ulong)digest[5] << 16)
                | ((ulong)digest[6] << 8) | digest[7];
        }
    }

    public static List<string> Sample(string[] population, int count, ulong seed)
    {
        if (count < 0 || count > population.Length)
        {
            throw new ArgumentOutOfRangeException(nameof(count));
        }
        var random = new PythonRandom(seed);
        var pool = (string[])population.Clone();
        var result = new List<string>(count);
        for (var i = 0; i < count; i++)
        {
            var index = random.RandBelow(population.Length - i);
            result.Add(pool[index]);
            pool[index] = pool[population.Length - i - 1];
        }
        result.Sort(StringComparer.Ordinal);
        return result;
    }

    private sealed class PythonRandom
    {
        private const int N = 624;
        private const int M = 397;
        private readonly uint[] state = new uint[N];
        private int index = N;

        public PythonRandom(ulong seed)
        {
            var key = seed > uint.MaxValue
                ? new[] { (uint)seed, (uint)(seed >> 32) }
                : new[] { (uint)seed };
            InitByArray(key);
        }

        public int RandBelow(int upperExclusive)
        {
            var bits = BitLength(upperExclusive);
            uint value;
            do
            {
                value = GetRandBits(bits);
            }
            while (value >= upperExclusive);
            return (int)value;
        }

        private static int BitLength(int value)
        {
            var bits = 0;
            while (value != 0)
            {
                bits++;
                value >>= 1;
            }
            return bits;
        }

        private uint GetRandBits(int bits)
        {
            return NextUInt32() >> (32 - bits);
        }

        private void InitGenRand(uint seed)
        {
            state[0] = seed;
            for (index = 1; index < N; index++)
            {
                state[index] = unchecked(1812433253U * (state[index - 1] ^ (state[index - 1] >> 30))
                    + (uint)index);
            }
        }

        private void InitByArray(uint[] key)
        {
            InitGenRand(19650218U);
            var i = 1;
            var j = 0;
            var rounds = Math.Max(N, key.Length);
            for (; rounds > 0; rounds--)
            {
                state[i] = unchecked((state[i] ^ ((state[i - 1] ^ (state[i - 1] >> 30)) * 1664525U))
                    + key[j] + (uint)j);
                i++;
                j++;
                if (i >= N) { state[0] = state[N - 1]; i = 1; }
                if (j >= key.Length) { j = 0; }
            }
            for (var rounds2 = N - 1; rounds2 > 0; rounds2--)
            {
                state[i] = unchecked((state[i] ^ ((state[i - 1] ^ (state[i - 1] >> 30)) * 1566083941U))
                    - (uint)i);
                i++;
                if (i >= N) { state[0] = state[N - 1]; i = 1; }
            }
            state[0] = 0x80000000U;
            index = N;
        }

        private uint NextUInt32()
        {
            if (index >= N)
            {
                for (var i = 0; i < N; i++)
                {
                    var y = (state[i] & 0x80000000U) | (state[(i + 1) % N] & 0x7fffffffU);
                    state[i] = state[(i + M) % N] ^ (y >> 1) ^ ((y & 1U) == 0 ? 0U : 0x9908b0dfU);
                }
                index = 0;
            }
            var value = state[index++];
            value ^= value >> 11;
            value ^= (value << 7) & 0x9d2c5680U;
            value ^= (value << 15) & 0xefc60000U;
            value ^= value >> 18;
            return value;
        }
    }
}""".strip()


def generate_csharp(
    plan: LeanPlan,
    settings: CSharpGenerationSettings = CSharpGenerationSettings(),
) -> str:
    """Generate a classic QCAlgorithm from a normalized, LEAN-specific plan."""

    plan = normalize_lean_plan(plan)
    if not settings.algorithm_class.isidentifier():
        raise ValueError("algorithm_class must be a valid identifier")

    selections = {item.id: item for item in plan.random_selections}
    momentum_selections = {item.id: item for item in plan.momentum_selections}
    sleeves = {item.id: item for item in plan.target_sleeves}
    rebalances = {item.id: item for item in plan.rebalances}
    predicates = tuple(item.predicate for item in plan.rebalances if item.predicate is not None)
    condition_values = tuple(
        value
        for rebalance in plan.rebalances
        for comparison in rebalance.condition
        for value in (comparison.left, comparison.right)
    )
    selection_values = tuple(
        value
        for selection in plan.momentum_selections
        for value in (
            _ranking_value(selection),
            *(operand for comparison in selection.eligibility for operand in (comparison.left, comparison.right)),
        )
    )
    temporal = plan.temporal_program
    snapshot_indexes = {snapshot.id: index for index, snapshot in enumerate(plan.target_snapshots)}
    cooldown_indexes = {state.id: index for index, state in enumerate(plan.cooldown_states)}
    scheduled_events = tuple(
        sorted(
            (*plan.daily_events, *plan.monthly_events, *plan.quarterly_events),
            key=lambda item: item.id,
        )
    )
    has_source_sleeves = bool(plan.target_snapshots) or any(
        item.source_sleeve_component_id is not None for item in plan.target_sleeves
    )
    history_symbols = frozenset(
        symbol for selection in plan.momentum_selections for symbol in selection.symbols
    ) | frozenset(item.asset for item in predicates if item.asset) | frozenset(
        symbol for value in (*condition_values, *selection_values) for symbol in _value_assets(value)
    )
    if temporal is not None:
        history_symbols = history_symbols | frozenset((temporal.anchor_symbol,))
    needs_history = bool(history_symbols)
    has_subscription_only_assets = history_symbols != frozenset(
        subscription.symbol for subscription in plan.subscriptions
    )
    lines = [
        "using System;",
        "using System.Collections.Generic;",
        "using System.Globalization;",
        "using System.Linq;",
        "using QuantConnect;",
        "using QuantConnect.Algorithm;",
        "using QuantConnect.Data;",
    ]
    if temporal is not None:
        lines.append("using QuantConnect.Orders;")
    if needs_history:
        lines.append("using QuantConnect.Indicators;")
    if plan.random_selections:
        lines[4:4] = [
            "using System.Security.Cryptography;",
            "using System.Text;",
            "using System.Text.Json;",
        ]
    lines.extend(
        [
            "",
            f"public class {settings.algorithm_class} : QCAlgorithm",
            "{",
            "    private readonly Dictionary<string, Symbol> _symbols = new Dictionary<string, Symbol>();",
            "    private int _decisionEvidenceSequence;",
        ]
    )
    if needs_history:
        lines.append(
            "    private readonly Dictionary<string, RollingWindow<decimal>> "
            "_dailyCloses = new Dictionary<string, RollingWindow<decimal>>();"
        )
        history_capacity = max(
            [item.lookback_bars + 1 for item in plan.momentum_selections]
            + [item.lookback_bars + 1 for item in predicates]
            + [_value_observations(value) for value in (*condition_values, *selection_values)]
            + ([1] if temporal is not None else [])
            + [1]
        )
    if temporal is not None:
        lines.extend((
            "    private int _boundaryIndex = -1;",
            "    private readonly Dictionary<string, string> _state = new Dictionary<string, string>();",
            "    private readonly Dictionary<string, decimal> _memory = new Dictionary<string, decimal>();",
            "    private readonly Dictionary<string, int> _eventCutoffs = new Dictionary<string, int>();",
            "    private readonly Dictionary<string, string> _eventTruth = new Dictionary<string, string>();",
            "    private readonly Dictionary<string, int> _eventCounts = new Dictionary<string, int>();",
            "    private readonly Dictionary<string, int> _stateEnteredCutoffs = new Dictionary<string, int>();",
            "    private readonly Dictionary<string, int> _memoryCaptureCutoffs = new Dictionary<string, int>();",
            "    private readonly Dictionary<string, string> _memoryValueIds = new Dictionary<string, string>();",
            "    private string _lastPolicyTarget = \"\";",
            "    private DateTime _lastTemporalBoundary = DateTime.MinValue;",
            "    private string _activeWeekKey = \"\";",
            "    private decimal? _activeWeekClose;",
            "    private string _activeWeekCutoff = \"\";",
            "    private decimal? _completedWeeklyClose;",
            "    private string _completedWeeklySourceCutoff = \"\";",
            "    private string _completedWeeklyAvailableCutoff = \"\";",
            "    private string _restoredPortfolioTarget = \"\";",
            "    private bool _portfolioRestorePending;",
        ))
    for index in range(len(scheduled_events)):
        lines.append(f"    private string _pendingEvent{index};")
    for index in range(len(plan.target_snapshots)):
        lines.extend(
            (
                f"    private Dictionary<string, decimal> _targetSnapshot{index};",
                f"    private string _targetSnapshotTimestamp{index};",
            )
        )
    if plan.cooldown_states:
        lines.extend(
            (
                "    private int _tradingSessionIndex = -1;",
                "    private DateTime _lastTradingSessionDate = DateTime.MinValue;",
            )
        )
    for index in range(len(plan.cooldown_states)):
        lines.extend(
            (
                f"    private readonly Dictionary<string, int> _lastExitSession{index} = new Dictionary<string, int>();",
                f"    private readonly Dictionary<string, string> _lastExitDate{index} = new Dictionary<string, string>();",
                f"    private readonly Dictionary<string, decimal> _previousTargets{index} = new Dictionary<string, decimal>();",
            )
        )
    lines.extend(
        (
            "",
            "    public override void Initialize()",
            "    {",
            (
                f"        SetStartDate({settings.start_date.year}, {settings.start_date.month}, "
                f"{settings.start_date.day});"
            ),
            (
                f"        SetEndDate({settings.end_date.year}, {settings.end_date.month}, "
                f"{settings.end_date.day});"
            ),
            f"        SetCash({_decimal_literal(settings.initial_cash)});",
        )
    )
    for subscription_index, subscription in enumerate(plan.subscriptions):
        ticker = _csharp_string(subscription.symbol)
        if needs_history:
            security_variable = f"security{subscription_index}"
            lines.extend(
                (
                    f"        var {security_variable} = AddEquity({ticker}, Resolution.Daily, "
                    "dataNormalizationMode: DataNormalizationMode.Adjusted);",
                    f"        _symbols[{ticker}] = {security_variable}.Symbol;",
                )
            )
            if subscription.symbol in history_symbols:
                lines.append(
                    f"        _dailyCloses[{ticker}] = new RollingWindow<decimal>({history_capacity});"
                )
        else:
            lines.append(f"        _symbols[{ticker}] = AddEquity({ticker}, Resolution.Daily).Symbol;")
    if needs_history:
        warm_up_bars = max(0, history_capacity - 1)
        if warm_up_bars:
            lines.append(f"        SetWarmUp({warm_up_bars}, Resolution.Daily);")
    if temporal is not None:
        for state_key, state_value in temporal.initial_state:
            lines.append(
                f"        _state[{_csharp_string(state_key)}] = {_csharp_string(state_value)};"
            )
        checkpoint = settings.temporal_checkpoint
        if checkpoint is not None:
            lines.extend((
                "        _state.Clear();",
                "        _eventCutoffs.Clear();",
                "        _eventTruth.Clear();",
                "        _eventCounts.Clear();",
                "        _memory.Clear();",
            ))
            for key, value in checkpoint.state:
                lines.append(f"        _state[{_csharp_string(key)}] = {_csharp_string(value)};")
            for key, value in checkpoint.state_entered_cutoffs:
                lines.append(f"        _stateEnteredCutoffs[{_csharp_string(key)}] = {value};")
            for key, value in checkpoint.event_cutoffs:
                lines.append(f"        _eventCutoffs[{_csharp_string(key)}] = {value};")
            for key, value in checkpoint.event_truths:
                lines.append(f"        _eventTruth[{_csharp_string(key)}] = {_csharp_string(value)};")
            for key, value in checkpoint.event_counts:
                lines.append(f"        _eventCounts[{_csharp_string(key)}] = {value};")
            for key, value in checkpoint.memory:
                lines.append(f"        _memory[{_csharp_string(key)}] = {_decimal_literal(value)};")
            for key, value in checkpoint.memory_capture_cutoffs:
                lines.append(f"        _memoryCaptureCutoffs[{_csharp_string(key)}] = {value};")
            for key, value in checkpoint.memory_value_ids:
                lines.append(f"        _memoryValueIds[{_csharp_string(key)}] = {_csharp_string(value)};")
            lines.extend((
                f"        _boundaryIndex = {checkpoint.boundary_index};",
                f"        _lastPolicyTarget = {_csharp_string(checkpoint.last_policy_target)};",
                f"        _activeWeekKey = {_csharp_string(checkpoint.active_week_key)};",
                f"        _activeWeekClose = {(('(decimal?)' + _decimal_literal(checkpoint.active_week_close)) if checkpoint.active_week_close is not None else '(decimal?)null')};",
                f"        _activeWeekCutoff = {_csharp_string(checkpoint.active_week_cutoff)};",
                f"        _completedWeeklyClose = {(('(decimal?)' + _decimal_literal(checkpoint.completed_weekly_close)) if checkpoint.completed_weekly_close is not None else '(decimal?)null')};",
                f"        _completedWeeklySourceCutoff = {_csharp_string(checkpoint.completed_weekly_source_cutoff)};",
                f"        _completedWeeklyAvailableCutoff = {_csharp_string(checkpoint.completed_weekly_available_cutoff)};",
                f"        _restoredPortfolioTarget = {_csharp_string(checkpoint.portfolio_target)};",
                "        _portfolioRestorePending = !string.IsNullOrEmpty(_restoredPortfolioTarget) && !_restoredPortfolioTarget.StartsWith(\"cash|\", StringComparison.Ordinal);",
                '        EmitDecisionEvidence(' + _csharp_string(checkpoint.cutoff) + ', "checkpoint_import", "checkpoint_import",',
                f'            "schema_version", {_csharp_string(checkpoint.schema_version)}, "integrity_hash", {_csharp_string(checkpoint.integrity_hash)},',
                f'            "restoration_identity", {_csharp_string(checkpoint.checkpoint_identity + ":" + checkpoint.cutoff)}, "source_cutoff", {_csharp_string(checkpoint.cutoff)});',
            ))
    for index, event in enumerate(scheduled_events):
        anchor = _csharp_string(event.anchor_symbol)
        date_rule = (
            f"DateRules.EveryDay(_symbols[{anchor}])"
            if isinstance(event, LeanDailyEvent)
            else f"DateRules.MonthStart(_symbols[{anchor}], {event.day - 1})"
        )
        lines.append(
            f"        Schedule.On({date_rule}, "
            f"TimeRules.AfterMarketOpen(_symbols[{anchor}], 1), QueueEvent{index});"
        )
    lines.extend(
        (
            "    }",
            "",
            "    private void EmitDecisionEvidence(string session, string phase, string kind, params string[] fields)",
            "    {",
            '        if (fields.Length % 2 != 0) throw new ArgumentException("Evidence fields must be key/value pairs.");',
            "        _decisionEvidenceSequence++;",
            "        var parts = new List<string>",
            "        {",
            '            "sequence=" + _decisionEvidenceSequence.ToString(CultureInfo.InvariantCulture),',
            '            "session=" + Uri.EscapeDataString(session),',
            '            "phase=" + Uri.EscapeDataString(phase),',
            '            "kind=" + Uri.EscapeDataString(kind)',
            "        };",
            "        for (var index = 0; index < fields.Length; index += 2)",
            "        {",
            '            parts.Add(Uri.EscapeDataString(fields[index]) + "=" + Uri.EscapeDataString(fields[index + 1] ?? ""));',
            "        }",
            '        Debug("RULETRADE_EVIDENCE_V2|" + string.Join("|", parts));',
            "    }",
            "",
            "    private static string EvidenceRanks(IEnumerable<string> ranked)",
            "    {",
            '        return string.Join(",", ranked.Select((asset, index) => asset + "=" + (index + 1).ToString(CultureInfo.InvariantCulture)));',
            "    }",
            "",
            "    private static string EvidenceSelectionStops(IEnumerable<string> ranked, IEnumerable<string> candidates, bool primaryComplete, bool fallbackConfigured)",
            "    {",
            "        var candidateSet = new HashSet<string>(candidates, StringComparer.Ordinal);",
            '        return string.Join(",", ranked.Select(asset =>',
            "        {",
            '            if (!candidateSet.Contains(asset)) return asset + "=rank_cutoff";',
            '            if (!primaryComplete) return asset + (fallbackConfigured ? "=fallback_replacement" : "=primary_selection_incomplete");',
            "            return null;",
            "        }).Where(item => item != null));",
            "    }",
            "",
        )
    )
    if needs_history:
        lines.extend(
            (
                "    private decimal? CurrentPrice(string ticker)",
                "    {",
                "        if (!_dailyCloses.TryGetValue(ticker, out var window) || window.Count < 1) return null;",
                "        return window[0];",
                "    }",
                "",
                "    private decimal? TrailingReturn(string ticker, int observations)",
                "    {",
                "        if (!_dailyCloses.TryGetValue(ticker, out var window) || window.Count < observations + 1 || window[observations] == 0m) return null;",
                "        return window[0] / window[observations] - 1m;",
                "    }",
                "",
                "    private decimal? RollingPrice(string ticker, int observations, string aggregate)",
                "    {",
                "        if (!_dailyCloses.TryGetValue(ticker, out var window) || window.Count < observations || observations < 1) return null;",
                "        var values = Enumerable.Range(0, observations).Select(index => window[index]).OrderBy(value => value).ToArray();",
                '        if (aggregate == "min") return values[0];',
                '        if (aggregate == "max") return values[values.Length - 1];',
                '        if (aggregate == "median") return values.Length % 2 == 1 ? values[values.Length / 2] : (values[values.Length / 2 - 1] + values[values.Length / 2]) / 2m;',
                "        return values.Average();",
                "    }",
                "",
            )
        )
    lines.extend(
        (
            "    private static decimal? ScaleValue(decimal? value, decimal factor)",
            "    {",
            "        return value.HasValue ? value.Value * factor : (decimal?)null;",
            "    }",
            "",
            "    private static decimal? WeightedScore(decimal?[] values, decimal[] weights, string missingPolicy, string normalization, decimal? clampMin, decimal? clampMax)",
            "    {",
            "        if (values.Length != weights.Length || values.Length == 0) return null;",
            '        if (missingPolicy == "require_all" && values.Any(value => !value.HasValue)) return null;',
            "        decimal total = 0m;",
            "        decimal availableWeight = 0m;",
            "        for (var index = 0; index < values.Length; index++)",
            "        {",
            "            if (!values[index].HasValue) continue;",
            "            total += values[index].Value * weights[index];",
            "            availableWeight += Math.Abs(weights[index]);",
            "        }",
            "        if (availableWeight == 0m) return null;",
            '        if (missingPolicy == "renormalize_available" || normalization == "sum_abs") total /= availableWeight;',
            "        if (clampMin.HasValue) total = Math.Max(clampMin.Value, total);",
            "        if (clampMax.HasValue) total = Math.Min(clampMax.Value, total);",
            "        return total;",
            "    }",
            "",
            "    private static bool CompareValues(decimal? left, decimal? right, string operation)",
            "    {",
            "        if (!left.HasValue || !right.HasValue) return false;",
            '        if (operation == ">") return left.Value > right.Value;',
            '        if (operation == ">=") return left.Value >= right.Value;',
            '        if (operation == "<") return left.Value < right.Value;',
            "        return left.Value <= right.Value;",
            "    }",
            "",
        )
    )

    for event_index, event in enumerate(scheduled_events):
        lines.extend(
            (
                f"    private void QueueEvent{event_index}()",
                "    {",
                *(
                    ("        if ((Time.Month - 1) % 3 != 0) return;",)
                    if isinstance(event, LeanQuarterlyEvent)
                    else ()
                ),
                (
                    f"        _pendingEvent{event_index} = "
                    'Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);'
                ),
                "    }",
                "",
            )
        )

    lines.extend(("    public override void OnData(Slice slice)", "    {"))
    if needs_history:
        if has_subscription_only_assets:
            tickers = ", ".join(_csharp_string(item) for item in sorted(history_symbols))
            lines.extend(
                (
                    f"        foreach (var ticker in new[] {{ {tickers} }})",
                    "        {",
                    "            var symbol = _symbols[ticker];",
                    "            if (slice.Bars.TryGetValue(symbol, out var bar))",
                    "            {",
                    "                _dailyCloses[ticker].Add(bar.Close);",
                    "            }",
                    "        }",
                    "        if (IsWarmingUp) return;",
                )
            )
        else:
            lines.extend(
                (
                    "        foreach (var item in _symbols)",
                    "        {",
                    "            if (slice.Bars.TryGetValue(item.Value, out var bar))",
                    "            {",
                    "                _dailyCloses[item.Key].Add(bar.Close);",
                    "            }",
                    "        }",
                    "        if (IsWarmingUp) return;",
                )
            )
    if plan.cooldown_states:
        calendar_symbols = {item.calendar_symbol for item in plan.cooldown_states}
        if len(calendar_symbols) != 1:
            raise ValueError("cooldown v0 requires one shared exchange calendar")
        calendar_symbol = _csharp_string(next(iter(calendar_symbols)))
        lines.extend(
            (
                "        if (_lastTradingSessionDate != Time.Date",
                f"            && Securities[_symbols[{calendar_symbol}]].Exchange.Hours.IsDateOpen(Time.Date, false))",
                "        {",
                "            _tradingSessionIndex++;",
                "            _lastTradingSessionDate = Time.Date;",
                "        }",
            )
        )
    if temporal is not None:
        anchor = _csharp_string(temporal.anchor_symbol)
        lines.extend((
            f"        if (_lastTemporalBoundary != Time.Date && slice.Bars.ContainsKey(_symbols[{anchor}]))",
            "        {",
            "            _lastTemporalBoundary = Time.Date;",
            '            var temporalCutoff = Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);',
            f"            if ({_csharp_string(temporal.profile)} == \"event-state-multiclock@1\")",
            "            {",
            '            var temporalWeekKey = ISOWeek.GetYear(Time.Date).ToString(CultureInfo.InvariantCulture) + "-W" + ISOWeek.GetWeekOfYear(Time.Date).ToString("D2", CultureInfo.InvariantCulture);',
            "            if (!string.IsNullOrEmpty(_activeWeekKey) && _activeWeekKey != temporalWeekKey)",
            "            {",
            "                _completedWeeklyClose = _activeWeekClose;",
            "                _completedWeeklySourceCutoff = _activeWeekCutoff;",
            "                _completedWeeklyAvailableCutoff = temporalCutoff;",
            '                EmitDecisionEvidence(temporalCutoff, "observation", "weekly_completion",',
            '                    "weekly_source_cutoff", _completedWeeklySourceCutoff, "available_cutoff", temporalCutoff,',
            '                    "value", _completedWeeklyClose.HasValue ? _completedWeeklyClose.Value.ToString("G29", CultureInfo.InvariantCulture) : "unknown");',
            "            }",
            "            _activeWeekKey = temporalWeekKey;",
            f"            _activeWeekClose = CurrentPrice({anchor});",
            "            _activeWeekCutoff = temporalCutoff;",
            "            }",
            "            if (_portfolioRestorePending)",
            "            {",
            '                var restoreParts = _restoredPortfolioTarget.Split(\'|\');',
            '                if (restoreParts.Length == 2 && restoreParts[0] == "asset" && _symbols.ContainsKey(restoreParts[1]))',
            "                {",
            "                    SetHoldings(_symbols[restoreParts[1]], 1m);",
            '                    EmitDecisionEvidence(temporalCutoff, "checkpoint_import", "portfolio_restore",',
            '                        "target_kind", "asset", "asset", restoreParts[1], "classification", "brokerage_reconstitution");',
            "                }",
            '                else if (restoreParts.Length == 2 && restoreParts[0] == "portfolio")',
            "                {",
            "                    foreach (var encoded in restoreParts[1].Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))",
            "                    {",
            "                        var pair = encoded.Split('=');",
            "                        if (pair.Length == 2 && _symbols.ContainsKey(pair[0]) && decimal.TryParse(pair[1], NumberStyles.Number, CultureInfo.InvariantCulture, out var restoredWeight)) SetHoldings(_symbols[pair[0]], restoredWeight);",
            "                    }",
            '                    EmitDecisionEvidence(temporalCutoff, "checkpoint_import", "portfolio_restore",',
            '                        "target_kind", "portfolio", "weights", restoreParts[1], "classification", "brokerage_reconstitution");',
            "                }",
            "                _portfolioRestorePending = false;",
            "            }",
            "            ExecuteTemporalBoundary(temporalCutoff);",
            "        }",
        ))
    if plan.target_snapshots:
        for event_index in range(len(scheduled_events)):
            lines.append(f"        string readyEvent{event_index} = null;")
        for event_index in range(len(scheduled_events)):
            lines.extend(
                (
                    f"        if (_pendingEvent{event_index} != null && Event{event_index}DataIsReady(slice))",
                    "        {",
                    f"            readyEvent{event_index} = _pendingEvent{event_index};",
                    f"            _pendingEvent{event_index} = null;",
                    "        }",
                )
            )
        for event_index, event in enumerate(scheduled_events):
            if event.refresh_ids:
                lines.append(
                    f"        if (readyEvent{event_index} != null) RefreshEvent{event_index}(readyEvent{event_index});"
                )
        for event_index, event in enumerate(scheduled_events):
            if event.rebalance_ids:
                lines.append(
                    f"        if (readyEvent{event_index} != null) ExecuteEvent{event_index}(readyEvent{event_index});"
                )
    else:
        for event_index in range(len(scheduled_events)):
            lines.extend(
                (
                    (
                        f"        if (_pendingEvent{event_index} != null "
                        f"&& Event{event_index}DataIsReady(slice))"
                    ),
                    "        {",
                    f"            var eventIdentity = _pendingEvent{event_index};",
                    f"            _pendingEvent{event_index} = null;",
                    f"            ExecuteEvent{event_index}(eventIdentity);",
                    "        }",
                )
            )
    lines.extend(("    }", ""))

    for event_index, event in enumerate(scheduled_events):
        tickers = ", ".join(_csharp_string(item) for item in event.execution.required_symbols)
        lines.extend(
            (
                f"    private bool Event{event_index}DataIsReady(Slice slice)",
                "    {",
                f"        return new[] {{ {tickers} }}.All(ticker =>",
                "        {",
                "            var symbol = _symbols[ticker];",
                (
                    "            return slice.Bars.ContainsKey(symbol) "
                    "&& Securities[symbol].HasData && Securities[symbol].Price > 0m;"
                ),
                "        });",
                "    }",
                "",
            )
        )

    for snapshot_index, snapshot in enumerate(plan.target_snapshots):
        if len(snapshot.sleeve_ids) != 1:
            raise ValueError("LEAN target snapshot v0 requires exactly one local target sleeve")
        sleeve = sleeves[snapshot.sleeve_ids[0]]
        variable = f"snapshotSelection{snapshot_index}"
        lines.extend(
            (
                f"    private void RefreshSnapshot{snapshot_index}(string eventIdentity, string scheduleName, string scheduleComponent)",
                "    {",
            )
        )
        if sleeve.selection_id is None:
            symbols = ", ".join(_csharp_string(item) for item in sleeve.symbols)
            lines.append(f"        var {variable} = new List<string> {{ {symbols} }};")
        else:
            selection = momentum_selections.get(sleeve.selection_id)
            if selection is None:
                raise ValueError("retained target snapshot v0 requires Momentum Top N")
            symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
            threshold = _decimal_literal(selection.filter_threshold or Decimal(0))
            ranking_expression = _value_csharp(_ranking_value(selection), "ticker")
            eligibility_expression = (
                " && ".join(_eligibility_condition(selection, item) for item in selection.eligibility)
                or _filter_condition(selection, "item.Value")
            )
            lines.extend(
                (
                    "        var scores = new Dictionary<string, decimal>();",
                    f"        foreach (var ticker in new[] {{ {symbols} }})",
                    "        {",
                    *(
                        (
                            "            var window = _dailyCloses[ticker];",
                            f"            if (window.Count >= {selection.lookback_bars + 1} && window[{selection.lookback_bars}] != 0m)",
                            "            {",
                            f"                scores[ticker] = window[0] / window[{selection.lookback_bars}] - 1m;",
                            "            }",
                        )
                        if _uses_legacy_trailing_return(selection)
                        else (
                            f"            var observed = {ranking_expression};",
                            "            if (observed.HasValue)",
                            "            {",
                            "                scores[ticker] = observed.Value;",
                            "            }",
                        )
                    ),
                    "        }",
                    *_condition_evidence_lines(
                        selection.eligibility,
                        selection.filter_component_id or "",
                        symbols,
                        f"snapshot{snapshot_index}Condition",
                    ),
                    f"        var eligible = scores.Where(item => {eligibility_expression})",
                    "            .ToDictionary(item => item.Key, item => item.Value);",
                    f'        Debug("RULETRADE_FILTER|" + eventIdentity + "|threshold=" + {threshold}.ToString("G29", CultureInfo.InvariantCulture)',
                    '            + "|eligible=" + string.Join(",", eligible.Keys.OrderBy(item => item))',
                    '            + "|rejected=" + string.Join(",", scores.Keys.Except(eligible.Keys).OrderBy(item => item)));',
                    '        EmitDecisionEvidence(eventIdentity, "evaluation", "filter",',
                    f'            "filter_component", {_csharp_string(selection.filter_component_id or "")}, "filter_field", {_csharp_string(_filter_field(selection))}, "operator", {_csharp_string(_filter_operator(selection))},',
                    f'            "threshold", {threshold}.ToString("G29", CultureInfo.InvariantCulture), "clauses", {_csharp_string(_filter_clause_evidence(selection))},',
                    f'            "decision_universe", string.Join(",", new[] {{ {symbols} }}),',
                    '            "scores", string.Join(",", scores.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                    '            "eligible", string.Join(",", eligible.Keys.OrderBy(item => item)),',
                    '            "rejected", string.Join(",", scores.Keys.Except(eligible.Keys).OrderBy(item => item)));',
                    f"        var ranked = eligible.{_ranking_method(selection)}(item => item.Value)",
                    "            .ThenBy(item => item.Key, StringComparer.Ordinal).ToList();",
                    f"        var {variable} = ranked.Take({selection.count}).Select(item => item.Key).ToList();",
                    '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                    '            + "|scores=" + string.Join(",", scores.OrderBy(item => item.Key)',
                    '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                    '            + "|ranked=" + string.Join(",", ranked.Select(item => item.Key))',
                    f'            + "|candidate=" + string.Join(",", {variable})',
                    f'            + "|selected=" + ({_selection_success(selection, variable)} ? string.Join(",", {variable}) : "")',
                    f'            + "|decision=" + ({_selection_success(selection, variable)} ? "executed" : "insufficient"));',
                    '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                    f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", {_csharp_string(selection.score_field)},',
                    f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                    f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                    '            "scores", string.Join(",", scores.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                    '            "ranked", string.Join(",", ranked.Select(item => item.Key)),',
                    f'            "candidates", string.Join(",", {variable}),',
                    f'            "primary_selected", ({_selection_success(selection, variable)} ? string.Join(",", {variable}) : ""),',
                    f'            "required_count", "{selection.count}", "evaluated", string.Join(",", ranked.Select(item => item.Key)),',
                    f'            "signal_present", string.Join(",", {variable}), "signal_absent", string.Join(",", ranked.Select(item => item.Key).Except({variable})),',
                    f'            "ranks", EvidenceRanks(ranked.Select(item => item.Key)), "stops", EvidenceSelectionStops(ranked.Select(item => item.Key), {variable}, {_selection_success(selection, variable)}, {str(bool(sleeve.fallback_symbols)).lower()}),',
                    f'            "decision", ({_selection_success(selection, variable)} ? "executed" : "insufficient"));',
                )
            )
            if sleeve.fallback_symbols:
                fallback_symbol = _csharp_string(sleeve.fallback_symbols[0])
                fallback_component = _csharp_string(sleeve.fallback_component_id or "")
                lines.extend(
                    (
                        f"        var fallbackActivated = {variable}.Count < {selection.count};",
                        "        if (fallbackActivated)",
                        "        {",
                        f"            {variable} = new List<string> {{ {fallback_symbol} }};",
                        f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=activated");',
                        f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "true");',
                        "        }",
                        "        else",
                        "        {",
                        f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=not_activated");',
                        f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "false");',
                        "        }",
                        f'        Debug("RULETRADE_FINAL|" + eventIdentity + "|selected=" + string.Join(",", {variable})',
                        '            + "|decision=executed|source=" + (fallbackActivated ? "fallback" : "primary"));',
                        '        EmitDecisionEvidence(eventIdentity, "selection", "final_selection",',
                        f'            "selection_component", (fallbackActivated ? {fallback_component} : {_csharp_string(selection.selection_component_id)}),',
                        f'            "selected", string.Join(",", {variable}), "source", (fallbackActivated ? "fallback" : "primary"));',
                    )
                )
            else:
                lines.append(f"        if ({variable}.Count < {selection.count}) return;")
        total = _decimal_literal(sleeve.total_weight)
        source_sleeve = _csharp_string(snapshot.source_sleeve_component_id)
        if sleeve.weighting_method == "proportional_score":
            if sleeve.selection_id is None or sleeve.fallback_symbols:
                raise ValueError("score-proportional snapshots require a scored Selection without fallback")
            lines.extend((
                f"        var positiveScoreTotal = {variable}.Sum(item => Math.Max(0m, scores[item]));",
                "        if (positiveScoreTotal <= 0m) return;",
                f"        _targetSnapshot{snapshot_index} = {variable}.ToDictionary(item => item, item => {total} * Math.Max(0m, scores[item]) / positiveScoreTotal);",
            ))
        else:
            lines.extend((
                f"        var localWeight = {total} / {variable}.Count;",
                f"        _targetSnapshot{snapshot_index} = {variable}.ToDictionary(item => item, item => localWeight);",
            ))
        lines.extend(
            (
                f"        _targetSnapshotTimestamp{snapshot_index} = eventIdentity;",
                f'        Debug("RULETRADE_REFRESH|" + eventIdentity + "|sleeve=" + {source_sleeve}',
                '            + "|schedule=" + scheduleName',
                f'            + "|local_targets=" + string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key)',
                '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                '            + "|snapshot=" + eventIdentity);',
                '        EmitDecisionEvidence(eventIdentity, "snapshot_commit", "snapshot_refresh",',
                f'            "sleeve_component", {source_sleeve}, "schedule_component", scheduleComponent, "schedule", scheduleName,',
                f'            "local_targets", string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                '            "snapshot_session", eventIdentity);',
                "    }",
                "",
            )
        )

    for event_index, event in enumerate(scheduled_events):
        if not event.refresh_ids:
            continue
        schedule_name = "quarterly" if isinstance(event, LeanQuarterlyEvent) else "monthly"
        lines.extend(
            (
                f"    private void RefreshEvent{event_index}(string eventIdentity)",
                "    {",
            )
        )
        for snapshot_id in event.refresh_ids:
            lines.append(
                f"        RefreshSnapshot{snapshot_indexes[snapshot_id]}(eventIdentity, {_csharp_string(schedule_name)}, {_csharp_string(event.id)});"
            )
        lines.extend(("    }", ""))

    for event_index, event in enumerate(scheduled_events):
        if not event.rebalance_ids:
            continue
        event_schedule = "quarterly" if isinstance(event, LeanQuarterlyEvent) else "monthly"
        lines.extend((f"    private void ExecuteEvent{event_index}(string eventIdentity)", "    {"))
        for rebalance_index, rebalance_id in enumerate(event.rebalance_ids):
            rebalance = rebalances[rebalance_id]
            predicate_outcome: str | None = None
            if rebalance.condition and not _uses_legacy_predicate(rebalance):
                predicate_outcome = f"predicateOutcome{event_index}_{rebalance_index}"
                clause_outcomes: list[str] = []
                for clause_index, comparison in enumerate(rebalance.condition):
                    left_name = f"predicateLeft{event_index}_{rebalance_index}_{clause_index}"
                    right_name = f"predicateRight{event_index}_{rebalance_index}_{clause_index}"
                    outcome_name = f"predicateClause{event_index}_{rebalance_index}_{clause_index}"
                    clause_outcomes.append(outcome_name)
                    lines.extend((
                        f"        var {left_name} = {_value_csharp(comparison.left, _csharp_string(''))};",
                        f"        var {right_name} = {_value_csharp(comparison.right, _csharp_string(''))};",
                        f"        var {outcome_name} = CompareValues({left_name}, {right_name}, {_csharp_string({'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<='}[comparison.operator])});",
                        '        EmitDecisionEvidence(eventIdentity, "evaluation", "value_condition",',
                        f'            "predicate_component", {_csharp_string(rebalance.predicate.component_id if rebalance.predicate else rebalance.id)}, "predicate_field", "condition",',
                        f'            "subject", {_csharp_string(comparison.left.asset or comparison.right.asset or "")}, "operator", {_csharp_string(comparison.operator)},',
                        f'            "left_definition", {_csharp_string(_value_json(comparison.left))}, "left_type", {_csharp_string(comparison.left.value_type)},',
                        f'            "left_observed", {left_name}.HasValue ? {left_name}.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
                        f'            "right_definition", {_csharp_string(_value_json(comparison.right))}, "right_type", {_csharp_string(comparison.right.value_type)},',
                        f'            "right_observed", {right_name}.HasValue ? {right_name}.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
                        f'            "outcome", {outcome_name} ? "true" : "false", "scope", "predicate");',
                    ))
                lines.append(f"        var {predicate_outcome} = {' && '.join(clause_outcomes)};")
                if not rebalance.otherwise_sleeve_ids and not rebalance.otherwise_snapshot_allocations:
                    lines.append(f"        if (!{predicate_outcome}) return;")
            elif rebalance.predicate is not None:
                predicate = rebalance.predicate
                predicate_window = f"predicateWindow{event_index}_{rebalance_index}"
                predicate_observed = f"predicateObserved{event_index}_{rebalance_index}"
                predicate_outcome = f"predicateOutcome{event_index}_{rebalance_index}"
                operator = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[predicate.operator]
                threshold = _decimal_literal(predicate.threshold)
                lines.extend(
                    (
                        f"        var {predicate_window} = _dailyCloses[{_csharp_string(predicate.asset)}];",
                        f"        decimal? {predicate_observed} = {predicate_window}.Count >= {predicate.lookback_bars + 1} && {predicate_window}[{predicate.lookback_bars}] != 0m",
                        f"            ? {predicate_window}[0] / {predicate_window}[{predicate.lookback_bars}] - 1m : (decimal?)null;",
                        f"        var {predicate_outcome} = {predicate_observed}.HasValue && {predicate_observed}.Value {operator} {threshold};",
                        '        EmitDecisionEvidence(eventIdentity, "evaluation", "predicate",',
                        f'            "predicate_component", {_csharp_string(predicate.component_id)}, "predicate_field", "condition",',
                        f'            "asset", {_csharp_string(predicate.asset)}, "measure", "trailing_return", "lookback_bars", "{predicate.lookback_bars}",',
                        f'            "operator", "{predicate.operator}", "observed", {predicate_observed}.HasValue ? {predicate_observed}.Value.ToString("G29", CultureInfo.InvariantCulture) : "",',
                        f'            "threshold", {threshold}.ToString("G29", CultureInfo.InvariantCulture), "outcome", {predicate_outcome} ? "true" : "false",',
                        f'            "branch", {predicate_outcome} ? "then" : "otherwise");',
                    )
                )
                if not rebalance.otherwise_sleeve_ids and not rebalance.otherwise_snapshot_allocations:
                    lines.append(f"        if (!{predicate_outcome}) return;")
            def emit_branch(
                branch_sleeve_ids: tuple[str, ...],
                branch_snapshot_allocations: tuple[LeanSnapshotAllocation, ...],
                branch_exit_state_ids: tuple[str, ...],
            ) -> None:
                targets_variable = f"targets{event_index}_{rebalance_index}"
                selected_variable = f"selectedTickers{event_index}_{rebalance_index}"
                lines.extend(
                    (
                        f"        var {targets_variable} = new Dictionary<Symbol, decimal>();",
                        f"        var {selected_variable} = new List<string>();",
                    )
                )
                if branch_snapshot_allocations:
                    missing = " || ".join(
                        f"_targetSnapshot{snapshot_indexes[item.snapshot_id]} == null"
                        for item in branch_snapshot_allocations
                    )
                    snapshot_times = ", ".join(
                        (
                            f'{_csharp_string(item.source_sleeve_component_id)} + "=" + '
                            f"_targetSnapshotTimestamp{snapshot_indexes[item.snapshot_id]}"
                        )
                        for item in branch_snapshot_allocations
                    )
                    lines.extend(
                        (
                            f"        if ({missing})",
                            "        {",
                            '            Debug("RULETRADE_PORTFOLIO_EVENT|" + eventIdentity',
                            f'                + "|schedule={event_schedule}|snapshots=|decision=skipped");',
                            f'            EmitDecisionEvidence(eventIdentity, "portfolio_execution", "snapshot_usage", "schedule_component", {_csharp_string(event.id)}, "schedule", "{event_schedule}", "snapshots", "", "executed", "false");',
                            "            return;",
                            "        }",
                            '        Debug("RULETRADE_PORTFOLIO_EVENT|" + eventIdentity',
                            f'            + "|schedule={event_schedule}|snapshots=" + string.Join(",", new[] {{ {snapshot_times} }})',
                            '            + "|decision=executed");',
                            '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "snapshot_usage",',
                            f'            "schedule_component", {_csharp_string(event.id)}, "schedule", "{event_schedule}",',
                            f'            "snapshots", string.Join(",", new[] {{ {snapshot_times} }}), "executed", "true");',
                        )
                    )
                    for allocation in branch_snapshot_allocations:
                        snapshot_index = snapshot_indexes[allocation.snapshot_id]
                        factor = _decimal_literal(allocation.factor)
                        sleeve_component = _csharp_string(allocation.source_sleeve_component_id)
                        lines.extend(
                            (
                                f"        foreach (var item in _targetSnapshot{snapshot_index})",
                                "        {",
                                "            var symbol = _symbols[item.Key];",
                                f"            var contribution = item.Value * {factor};",
                                f"            {targets_variable}[symbol] = {targets_variable}.ContainsKey(symbol)",
                                f"                ? {targets_variable}[symbol] + contribution : contribution;",
                                "        }",
                                f'        Debug("RULETRADE_SLEEVE|" + eventIdentity + "|sleeve=" + {sleeve_component}',
                                f'            + "|local_selected=" + string.Join(",", _targetSnapshot{snapshot_index}.Keys.OrderBy(item => item))',
                                f'            + "|local_weights=" + string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key)',
                                '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                f'            + "|allocation=" + {factor}.ToString("G29", CultureInfo.InvariantCulture)',
                                f'            + "|scaled=" + string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key)',
                                f'                .Select(item => item.Key + "=" + (item.Value * {factor}).ToString("G29", CultureInfo.InvariantCulture))));',
                                '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "sleeve_contribution",',
                                f'            "sleeve_component", {sleeve_component}, "allocation_component", {sleeve_component},',
                                f'            "local_selected", string.Join(",", _targetSnapshot{snapshot_index}.Keys.OrderBy(item => item)),',
                                f'            "local_targets", string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                f'            "allocation", {factor}.ToString("G29", CultureInfo.InvariantCulture),',
                                f'            "scaled_targets", string.Join(",", _targetSnapshot{snapshot_index}.OrderBy(item => item.Key).Select(item => item.Key + "=" + (item.Value * {factor}).ToString("G29", CultureInfo.InvariantCulture))));',
                            )
                        )
                for sleeve_index, sleeve_id in enumerate(branch_sleeve_ids):
                    sleeve = sleeves[sleeve_id]
                    variable = f"sleeve{event_index}_{rebalance_index}_{sleeve_index}"
                    weight_variable = f"weight{event_index}_{rebalance_index}_{sleeve_index}"
                    if sleeve.selection_id is None:
                        symbols = ", ".join(_csharp_string(item) for item in sleeve.symbols)
                        lines.append(f"        var {variable} = new[] {{ {symbols} }};")
                    else:
                        if sleeve.selection_id in selections:
                            selection = selections[sleeve.selection_id]
                            symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
                            lines.append(
                                f"        var {variable} = RuleTradeRandom.Sample("
                                f"new[] {{ {symbols} }}, {selection.count}, {_seed_expression(plan, selection)});"
                            )
                            lines.extend(
                                (
                                    '        EmitDecisionEvidence(eventIdentity, "selection", "random_selection",',
                                    f'            "selection_component", {_csharp_string(selection.component_id)}, "selection_field", "config.count",',
                                    f'            "universe", string.Join(",", new[] {{ {symbols} }}),',
                                    f'            "selected", string.Join(",", {variable}), "resample", "{selection.resample}",',
                                    f'            "required_count", "{selection.count}");',
                                )
                            )
                        else:
                            selection = momentum_selections[sleeve.selection_id]
                            symbols = ", ".join(_csharp_string(item) for item in selection.symbols)
                            scores_variable = f"scores{event_index}_{rebalance_index}_{sleeve_index}"
                            ranked_variable = f"ranked{event_index}_{rebalance_index}_{sleeve_index}"
                            ranking_expression = _value_csharp(_ranking_value(selection), "ticker")
                            lines.extend(
                                (
                                    f"        var {scores_variable} = new Dictionary<string, decimal>();",
                                    f"        foreach (var ticker in new[] {{ {symbols} }})",
                                    "        {",
                                    *(
                                        (
                                            "            var window = _dailyCloses[ticker];",
                                            f"            if (window.Count >= {selection.lookback_bars + 1} && window[{selection.lookback_bars}] != 0m)",
                                            "            {",
                                            f"                {scores_variable}[ticker] = window[0] / window[{selection.lookback_bars}] - 1m;",
                                            "            }",
                                        )
                                        if _uses_legacy_trailing_return(selection)
                                        else (
                                            f"            var observed = {ranking_expression};",
                                            "            if (observed.HasValue)",
                                            "            {",
                                            f"                {scores_variable}[ticker] = observed.Value;",
                                            "            }",
                                        )
                                    ),
                                    "        }",
                                )
                            )
                            lines.extend(_condition_evidence_lines(
                                selection.eligibility,
                                selection.filter_component_id or "",
                                symbols,
                                f"selection{event_index}_{rebalance_index}_{sleeve_index}Condition",
                            ))
                            ranking_input = scores_variable
                            if selection.filter_threshold is not None:
                                eligible_variable = (
                                    f"eligibleScores{event_index}_{rebalance_index}_{sleeve_index}"
                                )
                                threshold = _decimal_literal(selection.filter_threshold)
                                eligibility_expression = (
                                    " && ".join(
                                        _eligibility_condition(selection, item)
                                        for item in selection.eligibility
                                    )
                                    or _filter_condition(selection, "item.Value")
                                )
                                lines.extend(
                                    (
                                        f"        var {eligible_variable} = {scores_variable}",
                                        f"            .Where(item => {eligibility_expression})",
                                        "            .ToDictionary(item => item.Key, item => item.Value);",
                                        f'        Debug("RULETRADE_FILTER|" + eventIdentity + "|threshold=" + {threshold}.ToString("G29", CultureInfo.InvariantCulture)',
                                        f'            + "|eligible=" + string.Join(",", {eligible_variable}.Keys.OrderBy(item => item))',
                                        f'            + "|rejected=" + string.Join(",", {scores_variable}.Keys.Except({eligible_variable}.Keys).OrderBy(item => item)));',
                                        '        EmitDecisionEvidence(eventIdentity, "evaluation", "filter",',
                                        f'            "filter_component", {_csharp_string(selection.filter_component_id or "")}, "filter_field", {_csharp_string(_filter_field(selection))}, "operator", {_csharp_string(_filter_operator(selection))},',
                                        f'            "threshold", {threshold}.ToString("G29", CultureInfo.InvariantCulture), "clauses", {_csharp_string(_filter_clause_evidence(selection))},',
                                        f'            "decision_universe", string.Join(",", new[] {{ {symbols} }}),',
                                        f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                        f'            "eligible", string.Join(",", {eligible_variable}.Keys.OrderBy(item => item)),',
                                        f'            "rejected", string.Join(",", {scores_variable}.Keys.Except({eligible_variable}.Keys).OrderBy(item => item)));',
                                    )
                                )
                                ranking_input = eligible_variable
                            lines.extend(
                                (
                                    f"        var {ranked_variable} = {ranking_input}",
                                    f"            .{_ranking_method(selection)}(item => item.Value)",
                                    "            .ThenBy(item => item.Key, StringComparer.Ordinal)",
                                    "            .ToList();",
                                    f"        var {variable} = {ranked_variable}.Take({selection.count}).Select(item => item.Key).ToList();",
                                )
                            )
                            if selection.cooldown_state_id is not None:
                                state = next(
                                    item
                                    for item in plan.cooldown_states
                                    if item.id == selection.cooldown_state_id
                                )
                                state_index = cooldown_indexes[state.id]
                                candidate_variable = (
                                    f"signalCandidate{event_index}_{rebalance_index}_{sleeve_index}"
                                )
                                cooldown_eligible = (
                                    f"cooldownEligible{event_index}_{rebalance_index}_{sleeve_index}"
                                )
                                component_id = _csharp_string(state.component_id)
                                lines.extend(
                                    (
                                        f"        var {candidate_variable} = {variable}.ToList();",
                                        '        Debug("RULETRADE_SIGNAL|" + eventIdentity',
                                        f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                        '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                        f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                        f'            + "|candidate=" + string.Join(",", {candidate_variable}));',
                                        '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                                        f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", {_csharp_string(selection.score_field)},',
                                        f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                                        f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                                        f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                        f'            "ranked", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                        f'            "candidates", string.Join(",", {candidate_variable}), "primary_selected", "",',
                                        f'            "required_count", "{selection.count}", "evaluated", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                        f'            "signal_present", string.Join(",", {candidate_variable}), "signal_absent", string.Join(",", {ranked_variable}.Select(item => item.Key).Except({candidate_variable})),',
                                        f'            "ranks", EvidenceRanks({ranked_variable}.Select(item => item.Key)), "stops", EvidenceSelectionStops({ranked_variable}.Select(item => item.Key), {candidate_variable}, true, false),',
                                        f'            "decision", "signal");',
                                        f"        var {cooldown_eligible} = new List<string>();",
                                        f"        foreach (var ticker in {candidate_variable})",
                                        "        {",
                                        f"            var hasLastExit = _lastExitSession{state_index}.TryGetValue(ticker, out var lastExitSession);",
                                        "            var elapsed = hasLastExit ? _tradingSessionIndex - lastExitSession : -1;",
                                        f"            var allowed = !hasLastExit || elapsed >= {state.required_completed_sessions};",
                                        f"            if (allowed) {cooldown_eligible}.Add(ticker);",
                                        f'            Debug("RULETRADE_COOLDOWN|" + eventIdentity + "|component=" + {component_id}',
                                        '                + "|asset=" + ticker + "|candidate=true|last_exit="',
                                        f'                + (hasLastExit ? _lastExitDate{state_index}[ticker] : "none")',
                                        '                + "|elapsed_trading_days=" + (hasLastExit ? elapsed.ToString(CultureInfo.InvariantCulture) : "none")',
                                        f'                + "|required={state.required_completed_sessions}|decision=" + (allowed ? "eligible" : "blocked"));',
                                        '            EmitDecisionEvidence(eventIdentity, "selection", "cooldown",',
                                        f'                "cooldown_component", {component_id}, "cooldown_field", "config.duration", "asset", ticker, "signal_candidate", "true",',
                                        f'                "last_exit", (hasLastExit ? _lastExitDate{state_index}[ticker] : "none"),',
                                        '                "elapsed_sessions", (hasLastExit ? elapsed.ToString(CultureInfo.InvariantCulture) : "none"),',
                                        f'                "required_sessions", "{state.required_completed_sessions}", "eligible", (allowed ? "true" : "false"),',
                                        '                "stopping_stage", (allowed ? "" : "cooldown"));',
                                        "        }",
                                        f"        {variable} = {cooldown_eligible};",
                                        '        EmitDecisionEvidence(eventIdentity, "selection", "final_selection",',
                                        f'            "selection_component", {component_id}, "selected", string.Join(",", {variable}), "source", "primary");',
                                    )
                                )
                            eligible_count_variable = (
                                ranking_input if selection.filter_threshold is not None else variable
                            )
                            if selection.filter_threshold is not None:
                                insufficient_decision = (
                                    "insufficient" if sleeve.fallback_symbols
                                    else ("executed" if selection.shortage_policy == "choose_all" else "skipped")
                                )
                                lines.extend(
                                    (
                                        '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                                        f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                        '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                        f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                        f'            + "|candidate=" + string.Join(",", {variable})',
                                        f'            + "|selected=" + ({_selection_success(selection, variable)} ? string.Join(",", {variable}) : "")',
                                        f'            + "|decision=" + ({_selection_success(selection, variable)} ? "executed" : "{insufficient_decision}"));',
                                        '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                                        f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", {_csharp_string(selection.score_field)},',
                                        f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                                        f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                                        f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                        f'            "ranked", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                        f'            "candidates", string.Join(",", {variable}),',
                                        f'            "primary_selected", ({_selection_success(selection, variable)} ? string.Join(",", {variable}) : ""),',
                                        f'            "required_count", "{selection.count}", "evaluated", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                        f'            "signal_present", string.Join(",", {variable}), "signal_absent", string.Join(",", {ranked_variable}.Select(item => item.Key).Except({variable})),',
                                        f'            "ranks", EvidenceRanks({ranked_variable}.Select(item => item.Key)), "stops", EvidenceSelectionStops({ranked_variable}.Select(item => item.Key), {variable}, {_selection_success(selection, variable)}, {str(bool(sleeve.fallback_symbols)).lower()}),',
                                        f'            "decision", ({_selection_success(selection, variable)} ? "executed" : "{insufficient_decision}"));',
                                    )
                                )
                            if sleeve.fallback_symbols:
                                fallback_symbol = _csharp_string(sleeve.fallback_symbols[0])
                                fallback_component = _csharp_string(sleeve.fallback_component_id or "")
                                fallback_activated = (
                                    f"fallbackActivated{event_index}_{rebalance_index}_{sleeve_index}"
                                )
                                lines.extend(
                                    (
                                        f"        var {fallback_activated} = {variable}.Count < {selection.count};",
                                        f"        if ({fallback_activated})",
                                        "        {",
                                        f"            {variable} = new List<string> {{ {fallback_symbol} }};",
                                        f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=activated");',
                                        f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "true");',
                                        "        }",
                                        "        else",
                                        "        {",
                                        f'            Debug("RULETRADE_FALLBACK|" + eventIdentity + "|component=" + {fallback_component} + "|asset=" + {fallback_symbol} + "|decision=not_activated");',
                                        f'            EmitDecisionEvidence(eventIdentity, "selection", "fallback", "fallback_component", {fallback_component}, "asset", {fallback_symbol}, "activated", "false");',
                                        "        }",
                                        f'        Debug("RULETRADE_FINAL|" + eventIdentity + "|selected=" + string.Join(",", {variable})',
                                        f'            + "|decision=executed|source=" + ({fallback_activated} ? "fallback" : "primary"));',
                                        '        EmitDecisionEvidence(eventIdentity, "selection", "final_selection",',
                                        f'            "selection_component", ({fallback_activated} ? {fallback_component} : {_csharp_string(selection.selection_component_id)}),',
                                        f'            "selected", string.Join(",", {variable}), "source", ({fallback_activated} ? "fallback" : "primary"));',
                                    )
                                )
                            elif selection.cooldown_state_id is None and selection.shortage_policy == "require_full":
                                lines.extend(
                                    (
                                        f"        if ({variable}.Count < {selection.count})",
                                        "        {",
                                        f'            Debug("RULETRADE_MOMENTUM_SKIPPED|" + eventIdentity + "|eligible=" + {eligible_count_variable}.Count + "|required={selection.count}");',
                                        "            return;",
                                        "        }",
                                    )
                                )
                            elif selection.cooldown_state_id is None:
                                lines.extend(
                                    (
                                        f"        if ({variable}.Count == 0)",
                                        "        {",
                                        f'            Debug("RULETRADE_MOMENTUM_SKIPPED|" + eventIdentity + "|eligible=0|required={selection.count}");',
                                        "            return;",
                                        "        }",
                                    )
                                )
                            if selection.filter_threshold is None and selection.cooldown_state_id is None:
                                lines.extend(
                                    (
                                        '        Debug("RULETRADE_MOMENTUM|" + eventIdentity',
                                        f'            + "|scores=" + string.Join(",", {scores_variable}.OrderBy(item => item.Key)',
                                        '                .Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture)))',
                                        f'            + "|ranked=" + string.Join(",", {ranked_variable}.Select(item => item.Key))',
                                        f'            + "|selected=" + string.Join(",", {variable}));',
                                        '        EmitDecisionEvidence(eventIdentity, "selection", "selection",',
                                        f'            "score_component", {_csharp_string(selection.score_component_id)}, "score_field", {_csharp_string(selection.score_field)},',
                                        f'            "rank_component", {_csharp_string(selection.rank_component_id)}, "rank_field", "config.direction",',
                                        f'            "selection_component", {_csharp_string(selection.selection_component_id)}, "selection_field", "config.count",',
                                        f'            "scores", string.Join(",", {scores_variable}.OrderBy(item => item.Key).Select(item => item.Key + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))),',
                                        f'            "ranked", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                        f'            "candidates", string.Join(",", {variable}), "primary_selected", string.Join(",", {variable}),',
                                        f'            "required_count", "{selection.count}", "evaluated", string.Join(",", {ranked_variable}.Select(item => item.Key)),',
                                        f'            "signal_present", string.Join(",", {variable}), "signal_absent", string.Join(",", {ranked_variable}.Select(item => item.Key).Except({variable})),',
                                        f'            "ranks", EvidenceRanks({ranked_variable}.Select(item => item.Key)), "stops", EvidenceSelectionStops({ranked_variable}.Select(item => item.Key), {variable}, true, false),',
                                        f'            "decision", "executed");',
                                    )
                                )
                        lines.append(f"        {selected_variable}.AddRange({variable});")
                    weight = _decimal_literal(sleeve.total_weight)
                    cooldown_selection = (
                        momentum_selections.get(sleeve.selection_id) if sleeve.selection_id is not None else None
                    )
                    has_cooldown = (
                        cooldown_selection is not None and cooldown_selection.cooldown_state_id is not None
                    )
                    if has_cooldown:
                        lines.extend((f"        if ({variable}.Count > 0)", "        {"))
                    indent = "    " if has_cooldown else ""
                    if sleeve.weighting_method == "proportional_score":
                        if (
                            sleeve.selection_id is None
                            or sleeve.selection_id not in momentum_selections
                            or sleeve.fallback_symbols
                            or has_cooldown
                            or sleeve.source_sleeve_component_id is not None
                        ):
                            raise ValueError(
                                "score-proportional allocation requires one direct scored Selection without fallback, cooldown, or Portfolio scaling"
                            )
                        score_total_variable = f"positiveScoreTotal{event_index}_{rebalance_index}_{sleeve_index}"
                        lines.extend(
                            (
                                f"        var {score_total_variable} = {variable}.Sum(ticker => Math.Max(0m, {scores_variable}[ticker]));",
                                f"        if ({score_total_variable} <= 0m) return;",
                                f"        foreach (var ticker in {variable})",
                                "        {",
                                f"            var {weight_variable} = {weight} * Math.Max(0m, {scores_variable}[ticker]) / {score_total_variable};",
                                "            var symbol = _symbols[ticker];",
                                (
                                    f"            {targets_variable}[symbol] = "
                                    f"{targets_variable}.ContainsKey(symbol) ? "
                                    f"{targets_variable}[symbol] + {weight_variable} : {weight_variable};"
                                ),
                                "        }",
                                '        EmitDecisionEvidence(eventIdentity, "allocation", "score_proportional",',
                                f'            "allocation_component", {_csharp_string(sleeve.allocation_component_id or sleeve.id)}, "method", "proportional_score",',
                                f'            "positive_score_total", {score_total_variable}.ToString("G29", CultureInfo.InvariantCulture));',
                            )
                        )
                    else:
                        lines.extend(
                            (
                                f"{indent}        var {weight_variable} = {weight} / {variable}.Count();",
                                f"{indent}        foreach (var ticker in {variable})",
                                f"{indent}        {{",
                                f"{indent}            var symbol = _symbols[ticker];",
                                (
                                    f"{indent}            {targets_variable}[symbol] = "
                                    f"{targets_variable}.ContainsKey(symbol) ? "
                                    f"{targets_variable}[symbol] + {weight_variable} : {weight_variable};"
                                ),
                                f"{indent}        }}",
                            )
                        )
                    if has_cooldown:
                        lines.append("        }")
                    if sleeve.source_sleeve_component_id is not None:
                        if has_cooldown:
                            raise ValueError("cooldown v0 does not support portfolio sleeves")
                        local_total = _decimal_literal(sleeve.local_total_weight or Decimal(1))
                        allocation = _decimal_literal(sleeve.source_allocation or Decimal(1))
                        local_weight_variable = f"localWeight{event_index}_{rebalance_index}_{sleeve_index}"
                        sleeve_component = _csharp_string(sleeve.source_sleeve_component_id)
                        lines.extend(
                            (
                                f"        var {local_weight_variable} = {local_total} / {variable}.Count();",
                                f'        Debug("RULETRADE_SLEEVE|" + eventIdentity + "|sleeve=" + {sleeve_component}',
                                f'            + "|local_selected=" + string.Join(",", {variable}.OrderBy(item => item))',
                                f'            + "|local_weights=" + string.Join(",", {variable}.OrderBy(item => item)',
                                f'                .Select(item => item + "=" + {local_weight_variable}.ToString("G29", CultureInfo.InvariantCulture)))',
                                f'            + "|allocation=" + {allocation}.ToString("G29", CultureInfo.InvariantCulture)',
                                f'            + "|scaled=" + string.Join(",", {variable}.OrderBy(item => item)',
                                f'                .Select(item => item + "=" + {weight_variable}.ToString("G29", CultureInfo.InvariantCulture))));',
                                '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "sleeve_contribution",',
                                f'            "sleeve_component", {sleeve_component}, "allocation_component", {_csharp_string(sleeve.id)},',
                                f'            "local_selected", string.Join(",", {variable}.OrderBy(item => item)),',
                                f'            "local_targets", string.Join(",", {variable}.OrderBy(item => item).Select(item => item + "=" + {local_weight_variable}.ToString("G29", CultureInfo.InvariantCulture))),',
                                f'            "allocation", {allocation}.ToString("G29", CultureInfo.InvariantCulture),',
                                f'            "scaled_targets", string.Join(",", {variable}.OrderBy(item => item).Select(item => item + "=" + {weight_variable}.ToString("G29", CultureInfo.InvariantCulture))));',
                            )
                        )
                for state_id in branch_exit_state_ids:
                    state = next(item for item in plan.cooldown_states if item.id == state_id)
                    state_index = cooldown_indexes[state_id]
                    state_symbols = ", ".join(_csharp_string(item) for item in state.symbols)
                    component_id = _csharp_string(state.component_id)
                    lines.extend(
                        (
                            f"        foreach (var ticker in new[] {{ {state_symbols} }})",
                            "        {",
                            f"            var hadTarget = _previousTargets{state_index}.TryGetValue(ticker, out var oldTarget) && oldTarget > 0m;",
                            f"            var hasTarget = {targets_variable}.TryGetValue(_symbols[ticker], out var newTarget) && newTarget > 0m;",
                            "            if (hadTarget && !hasTarget)",
                            "            {",
                            f'                var oldExit = _lastExitDate{state_index}.TryGetValue(ticker, out var priorExit) ? priorExit : "none";',
                            f"                _lastExitSession{state_index}[ticker] = _tradingSessionIndex;",
                            f"                _lastExitDate{state_index}[ticker] = eventIdentity;",
                            f'                Debug("RULETRADE_STATE|" + eventIdentity + "|component=" + {component_id}',
                            '                    + "|asset=" + ticker + "|state=last_exit|old=" + oldExit',
                            '                    + "|new=" + eventIdentity + "|cause=target_exit");',
                            '                EmitDecisionEvidence(eventIdentity, "state_mutation", "state_mutation",',
                            f'                    "state_component", {component_id}, "asset", ticker, "state", "last_exit",',
                            '                    "old_value", oldExit, "new_value", eventIdentity, "cause", "target_exit");',
                            "            }",
                            f"            _previousTargets{state_index}[ticker] = hasTarget ? newTarget : 0m;",
                            "        }",
                        )
                    )
                final_selected_expression = (
                    f"{targets_variable}.Where(item => item.Value != 0m).Select(item => item.Key.Value)"
                    if has_source_sleeves
                    else selected_variable
                )
                lines.extend(
                    (
                        "        foreach (var holding in Portfolio.Values.Where(item => item.Invested))",
                        "        {",
                        (
                            f"            if (!{targets_variable}.ContainsKey(holding.Symbol)) "
                            "Liquidate(holding.Symbol);"
                        ),
                        "        }",
                        (
                            f"        foreach (var target in {targets_variable}) "
                            "SetHoldings(target.Key, target.Value);"
                        ),
                        ('        Debug("RULETRADE_TARGETS|" + eventIdentity'),
                        (
                            f'            + "|selected=" + string.Join(",", '
                            + (
                                f"{targets_variable}.Where(item => item.Value != 0m)"
                                ".Select(item => item.Key.Value)"
                                if has_source_sleeves
                                else selected_variable
                            )
                            + ".OrderBy(item => item, StringComparer.Ordinal))"
                        ),
                        (
                            f'            + "|weights=" + string.Join(",", {targets_variable}'
                            ".OrderBy(item => item.Key.Value)"
                        ),
                        (
                            '                .Select(item => item.Key.Value + "=" + '
                            "item.Value.ToString(CultureInfo.InvariantCulture))));"
                        ),
                        '        EmitDecisionEvidence(eventIdentity, "portfolio_execution", "final_targets",',
                        f'            "rebalance_component", {_csharp_string(rebalance.id)},',
                        f'            "selected", string.Join(",", {final_selected_expression}.OrderBy(item => item, StringComparer.Ordinal)),',
                        f'            "targets", string.Join(",", {targets_variable}.OrderBy(item => item.Key.Value).Select(item => item.Key.Value + "=" + item.Value.ToString("G29", CultureInfo.InvariantCulture))));',
                    )
                )

            has_otherwise_branch = bool(
                rebalance.otherwise_sleeve_ids or rebalance.otherwise_snapshot_allocations
            )
            if predicate_outcome is not None and has_otherwise_branch:
                lines.extend((f"        if ({predicate_outcome})", "        {"))
                emit_branch(
                    rebalance.sleeve_ids,
                    rebalance.snapshot_allocations,
                    rebalance.exit_state_ids,
                )
                lines.extend(("        }", "        else", "        {"))
                emit_branch(
                    rebalance.otherwise_sleeve_ids,
                    rebalance.otherwise_snapshot_allocations,
                    rebalance.otherwise_exit_state_ids,
                )
                lines.append("        }")
            else:
                emit_branch(
                    rebalance.sleeve_ids,
                    rebalance.snapshot_allocations,
                    rebalance.exit_state_ids,
                )
        lines.extend(("    }", ""))

    lines.extend(_temporal_method_lines(plan, settings))
    lines.append("}")
    if plan.random_selections:
        lines.extend(("", _random_helper_source(), ""))
    else:
        lines.append("")
    return "\n".join(lines)
