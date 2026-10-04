from __future__ import annotations

import typing
from collections.abc import Mapping
from decimal import Decimal

from ruletrade.hashing import strategy_hash
from ruletrade.ir import strategy as strategy_ir
from ruletrade.strategy.v1.models import (
    ArithmeticExpression,
    BooleanExpression,
    CandidateExpression,
    CanonicalStrategyV1,
    ComparisonExpression,
    Component,
    ComponentOutputExpression,
    CurrentExpression,
    IndicatorExpression,
    LiteralExpression,
    MarketSeriesExpression,
    RebalanceAction,
    RollingAggregateExpression,
)
from ruletrade.strategy.v1.randomness import canonical_parameter_bindings_json
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry

SUPPORTED_SOURCE_IMPLEMENTATIONS = frozenset(
    {
        "event.daily",
        "event.monthly",
        "event.quarterly",
        "asset_set.named",
        "universe.named",
        "selection.random_n_v1",
        "market.trailing_return",
        "selection.filter",
        "selection.rank",
        "selection.top_n",
        "selection.cooldown",
        "allocation.equal_weight",
        "targets.merge",
        "targets.fallback_asset",
        "portfolio.sleeve",
        "portfolio.compose",
        "effect.rebalance",
        "rule.condition_actions",
    }
)


class StrategyDesugaringError(ValueError):
    pass


def _compile_value(expression: object, *, candidate_allowed: bool) -> strategy_ir.ExecutableValue:
    if isinstance(expression, LiteralExpression) and expression.value_type.value in {
        "decimal", "percentage", "money_per_share"
    }:
        return strategy_ir.ExecutableValue(
            kind="literal", value_type=typing.cast(typing.Any, expression.value_type.value),
            literal=Decimal(str(expression.value)),
        )
    if isinstance(expression, IndicatorExpression) and expression.indicator_id == "trailing_return_indicator@1":
        subject = expression.asset
        if isinstance(subject, CandidateExpression) and candidate_allowed:
            subject_kind, asset = "candidate", None
        elif isinstance(subject, LiteralExpression) and subject.value_type.value == "asset":
            subject_kind, asset = "asset", str(subject.value)
        else:
            raise StrategyDesugaringError("executable trailing return requires an Asset or in-scope Candidate")
        return strategy_ir.ExecutableValue(
            kind="trailing_return", value_type="percentage", subject=subject_kind,
            asset=asset, observations=int(expression.parameters["lookback_bars"]),
        )
    if isinstance(expression, CurrentExpression) and isinstance(expression.series, MarketSeriesExpression):
        if expression.series.field != "price":
            raise StrategyDesugaringError("current Volume is not executable with the maintained data contract")
        subject = expression.series.subject
        if isinstance(subject, CandidateExpression) and candidate_allowed:
            subject_kind, asset = "candidate", None
        elif isinstance(subject, LiteralExpression) and subject.value_type.value == "asset":
            subject_kind, asset = "asset", str(subject.value)
        else:
            raise StrategyDesugaringError("executable current price requires an Asset or in-scope Candidate")
        return strategy_ir.ExecutableValue(
            kind="current_price", value_type="money_per_share", subject=subject_kind, asset=asset,
        )
    if isinstance(expression, RollingAggregateExpression) and isinstance(expression.series, MarketSeriesExpression):
        if expression.series.field != "price":
            raise StrategyDesugaringError("rolling Volume is not executable with the maintained data contract")
        subject = expression.series.subject
        if isinstance(subject, CandidateExpression) and candidate_allowed:
            subject_kind, asset = "candidate", None
        elif isinstance(subject, LiteralExpression) and subject.value_type.value == "asset":
            subject_kind, asset = "asset", str(subject.value)
        else:
            raise StrategyDesugaringError("executable rolling price requires an Asset or in-scope Candidate")
        return strategy_ir.ExecutableValue(
            kind="rolling_price", value_type="money_per_share", subject=subject_kind,
            asset=asset, observations=expression.window_observations, aggregate=expression.operator,
        )
    if isinstance(expression, ArithmeticExpression) and expression.operator == "multiply":
        operands = ((expression.left, expression.right), (expression.right, expression.left))
        for value_expression, factor_expression in operands:
            if isinstance(factor_expression, LiteralExpression) and factor_expression.value_type.value == "decimal":
                operand = _compile_value(value_expression, candidate_allowed=candidate_allowed)
                return strategy_ir.ExecutableValue(
                    kind="scale", value_type=operand.value_type, operand=operand,
                    factor=Decimal(str(factor_expression.value)),
                )
    raise StrategyDesugaringError(
        "Strategy execution supports trailing return, current price, rolling price aggregate, literal, and scalar scale"
    )


def _compile_comparison(expression: object, *, candidate_allowed: bool) -> strategy_ir.ExecutableComparison:
    if not isinstance(expression, ComparisonExpression) or expression.operator not in {"gt", "gte", "lt", "lte"}:
        raise StrategyDesugaringError("executable conditions require ordered value comparisons")
    return strategy_ir.ExecutableComparison(
        operator=typing.cast(typing.Literal["gt", "gte", "lt", "lte"], expression.operator),
        left=_compile_value(expression.left, candidate_allowed=candidate_allowed),
        right=_compile_value(expression.right, candidate_allowed=candidate_allowed),
    )


def _eligibility_clauses(component: Component) -> tuple[strategy_ir.FilterClause, ...]:
    expression = component.condition
    if expression is None:
        return ()
    operands = expression.operands if isinstance(expression, BooleanExpression) and expression.operator == "and" else [expression]
    clauses: list[strategy_ir.FilterClause] = []
    for operand in operands:
        comparison = _compile_comparison(operand, candidate_allowed=True)
        if comparison.left.subject != "candidate" and comparison.right.subject != "candidate":
            raise StrategyDesugaringError("Eligibility values must reference the current Candidate")
        threshold = comparison.right.literal if comparison.right.kind == "literal" else Decimal(0)
        clauses.append(strategy_ir.FilterClause(operator=comparison.operator, threshold=threshold, comparison=comparison))
    return tuple(clauses)


def _candidate_trailing_return(expression: object) -> bool:
    return (
        isinstance(expression, IndicatorExpression)
        and expression.indicator_id == "trailing_return_indicator@1"
        and isinstance(expression.asset, CandidateExpression)
    )


def desugar_strategy(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
    *,
    parameter_bindings: Mapping[str, object] | None = None,
) -> strategy_ir.StrategyIR:
    """Lower the validated Strategy Model into the small Strategy IR kernel."""

    asset_sets = {definition.id: tuple(definition.assets) for definition in strategy.definitions.asset_sets}
    groups = {definition.id: definition.asset_set_ref for definition in strategy.definitions.groups}
    universes = {definition.id: definition for definition in strategy.definitions.universes}
    inputs: dict[tuple[str, str], list[str]] = {}
    for connection in strategy.graph.connections:
        inputs.setdefault((connection.target.component_id, connection.target.port), []).append(
            connection.source.component_id
        )
    implementations = {
        component.id: registry.get(component.primitive).implementation_id
        for component in strategy.graph.components
    }
    components = {component.id: component for component in strategy.graph.components}
    scheduled_sleeves = {
        entrypoint.target_component_id
        for entrypoint in strategy.entrypoints
        if implementations.get(entrypoint.target_component_id) == "portfolio.sleeve"
    }
    sleeve_outputs: dict[str, str] = {}
    user_state: list[strategy_ir.PerAssetState] = []
    cooldown_states: dict[str, str] = {}
    unsupported = sorted(set(implementations.values()) - SUPPORTED_SOURCE_IMPLEMENTATIONS)
    if unsupported:
        raise StrategyDesugaringError(
            f"unsupported Strategy IR v0 primitive implementations: {', '.join(unsupported)}"
        )
    if strategy.definitions.state:
        raise StrategyDesugaringError(
            "rule.condition_actions predicate v1 does not support state definitions"
        )

    def config(component: Component) -> dict[str, object]:
        return registry.resolve_config(component.primitive, component.config)

    def input_id(component: Component, port: str) -> str:
        try:
            values = inputs[(component.id, port)]
        except KeyError as exc:
            raise StrategyDesugaringError(f"missing source for {component.id}.{port}") from exc
        if len(values) != 1:
            raise StrategyDesugaringError(f"expected one source for {component.id}.{port}")
        return values[0]

    def input_ids(component: Component, port: str) -> tuple[str, ...]:
        values = tuple(sorted(inputs.get((component.id, port), ())))
        if not values:
            raise StrategyDesugaringError(f"missing source for {component.id}.{port}")
        return values

    operations: list[strategy_ir.StrategyIROperation] = []
    bindings_json = canonical_parameter_bindings_json(strategy, parameter_bindings)
    for component in strategy.graph.components:
        implementation = implementations[component.id]
        provenance = strategy_ir.SourceProvenance(component_id=component.id)
        resolved = config(component)
        if implementation == "event.daily":
            operation = strategy_ir.DailyScheduleOp(
                id=component.id,
                provenance=provenance,
            )
        elif implementation == "event.monthly":
            operation = strategy_ir.MonthlyScheduleOp(
                id=component.id,
                day=int(resolved["day"]),
                provenance=provenance,
            )
        elif implementation == "event.quarterly":
            operation = strategy_ir.QuarterlyScheduleOp(
                id=component.id,
                day=int(resolved["day"]),
                provenance=provenance,
            )
        elif implementation == "asset_set.named":
            operation = strategy_ir.AssetSetOp(
                id=component.id,
                symbols=asset_sets[str(resolved["asset_set_ref"])],
                provenance=provenance,
            )
        elif implementation == "universe.named":
            universe_id = str(resolved["universe_ref"])
            universe = universes[universe_id]
            if universe.source == "provider":
                raise StrategyDesugaringError(
                    f"provider-backed universe {universe_id} is semantic-only until a provider resolves membership point-in-time"
                )
            asset_set_id = (
                universe.asset_set_ref
                if universe.source == "asset_set"
                else groups[str(universe.group_ref)]
            )
            operation = strategy_ir.UniverseOp(
                id=component.id,
                universe_id=universe_id,
                source_kind=typing.cast(typing.Literal["asset_set", "group"], universe.source),
                symbols=asset_sets[str(asset_set_id)],
                provenance=provenance,
            )
        elif implementation == "selection.random_n_v1":
            operation = strategy_ir.RandomNOp(
                id=component.id,
                assets=input_id(component, "assets"),
                count=int(resolved["count"]),
                resample=typing.cast(
                    typing.Literal["once", "per_event"],
                    str(resolved["resample"]),
                ),
                parameter_bindings_json=bindings_json,
                provenance=provenance,
            )
        elif implementation == "market.trailing_return":
            operation = strategy_ir.TrailingReturnOp(
                id=component.id,
                assets=input_id(component, "assets"),
                lookback_bars=int(resolved["lookback_bars"]),
                provenance=provenance,
            )
        elif implementation == "selection.filter":
            clauses = _eligibility_clauses(component)
            legacy_operator = typing.cast(typing.Literal["gt", "gte", "lt", "lte"], resolved["operator"])
            legacy_threshold = Decimal(str(resolved["threshold"]))
            operation = strategy_ir.FilterOp(
                id=component.id, scores=input_id(component, "scores"),
                operator=clauses[0].operator if clauses else legacy_operator,
                threshold=clauses[0].threshold if clauses else legacy_threshold,
                provenance=provenance, clauses=clauses,
            )
        elif implementation == "selection.rank":
            operation = strategy_ir.RankOp(
                id=component.id,
                scores=input_id(component, "scores"),
                direction=typing.cast(typing.Literal["descending", "ascending"], resolved["direction"]),
                provenance=provenance,
                value=(
                    _compile_value(component.value_expression, candidate_allowed=True)
                    if component.value_expression is not None else None
                ),
            )
        elif implementation == "selection.top_n":
            operation = strategy_ir.TopNOp(
                id=component.id,
                ranked=input_id(component, "ranked"),
                count=int(resolved["count"]),
                provenance=provenance,
                shortage_policy=typing.cast(typing.Literal["require_full", "choose_all"], resolved["shortage_policy"]),
            )
        elif implementation == "selection.cooldown":
            state_id = f"{component.id}$last_exit"
            cooldown_states[component.id] = state_id
            user_state.append(
                strategy_ir.PerAssetState(
                    id=state_id,
                    value_type="trading_session_index",
                    initial=None,
                    provenance=provenance,
                )
            )
            operation = strategy_ir.ElapsedSessionsGateOp(
                id=component.id,
                candidates=input_id(component, "candidates"),
                last_exit_state=state_id,
                minimum_completed_sessions=int(resolved["duration"]),
                provenance=provenance,
            )
        elif implementation == "allocation.equal_weight":
            operation = strategy_ir.EqualWeightOp(
                id=component.id,
                assets=input_id(component, "assets"),
                total_weight=Decimal(str(resolved["total"])),
                provenance=provenance,
            )
        elif implementation == "targets.merge":
            operation = strategy_ir.MergeTargetsOp(
                id=component.id,
                left=input_id(component, "left"),
                right=input_id(component, "right"),
                provenance=provenance,
            )
        elif implementation == "targets.fallback_asset":
            primary_id = input_id(component, "primary")
            primary_component = components[primary_id]
            if implementations[primary_id] != "allocation.equal_weight":
                raise StrategyDesugaringError("fallback v0 primary must be equal-weight targets")
            reference = str(resolved["fallback_asset_set_ref"])
            fallback_symbols = asset_sets[reference]
            if len(fallback_symbols) != 1:
                raise StrategyDesugaringError("fallback v0 requires exactly one asset")
            fallback_assets_id = f"{component.id}$assets"
            fallback_targets_id = f"{component.id}$targets"
            primary_total = Decimal(str(config(primary_component)["total"]))
            operations.extend(
                (
                    strategy_ir.AssetSetOp(
                        id=fallback_assets_id,
                        symbols=fallback_symbols,
                        provenance=provenance,
                    ),
                    strategy_ir.EqualWeightOp(
                        id=fallback_targets_id,
                        assets=fallback_assets_id,
                        total_weight=primary_total,
                        provenance=provenance,
                    ),
                )
            )
            operation = strategy_ir.FirstNonEmptyTargetsOp(
                id=component.id,
                primary=primary_id,
                fallback=fallback_targets_id,
                provenance=provenance,
            )
        elif implementation == "portfolio.sleeve":
            local_targets = input_id(component, "local_targets")
            if component.id in scheduled_sleeves:
                operations.append(
                    strategy_ir.RetainTargetsOp(
                        id=component.id,
                        targets=local_targets,
                        provenance=provenance,
                    )
                )
                output_id = f"{component.id}$scaled"
                sleeve_outputs[component.id] = output_id
                operation = strategy_ir.ScaleTargetsOp(
                    id=output_id,
                    targets=component.id,
                    factor=Decimal(str(resolved["allocation"])),
                    provenance=provenance,
                )
            else:
                operation = strategy_ir.ScaleTargetsOp(
                    id=component.id,
                    targets=local_targets,
                    factor=Decimal(str(resolved["allocation"])),
                    provenance=provenance,
                )
        elif implementation == "portfolio.compose":
            sleeve_ids = tuple(sleeve_outputs.get(item, item) for item in input_ids(component, "sleeves"))
            if len(sleeve_ids) != 2:
                raise StrategyDesugaringError("portfolio v0 requires exactly two sleeves")
            operation = strategy_ir.MergeTargetsOp(
                id=component.id,
                left=sleeve_ids[0],
                right=sleeve_ids[1],
                provenance=provenance,
            )
        elif implementation == "effect.rebalance":
            targets = input_id(component, "targets")
            matching_cooldowns = [
                cooldown_id
                for cooldown_id in cooldown_states
                if _source_depends_on(targets, cooldown_id, inputs)
            ]
            if len(matching_cooldowns) > 1:
                raise StrategyDesugaringError("cooldown v0 supports one stateful gate")
            if matching_cooldowns:
                cooldown_id = matching_cooldowns[0]
                observed_targets = f"{cooldown_id}$observe_exits"
                operations.append(
                    strategy_ir.ObserveTargetExitsOp(
                        id=observed_targets,
                        targets=targets,
                        last_exit_state=cooldown_states[cooldown_id],
                        provenance=strategy_ir.SourceProvenance(component_id=cooldown_id),
                    )
                )
                targets = observed_targets
            operation = strategy_ir.RebalanceOp(
                id=component.id,
                targets=targets,
                provenance=provenance,
            )
        elif implementation == "rule.condition_actions":
            condition = component.condition
            operands = condition.operands if isinstance(condition, BooleanExpression) and condition.operator == "and" else [condition]
            try:
                comparisons = tuple(
                    _compile_comparison(item, candidate_allowed=False) for item in operands
                )
            except StrategyDesugaringError:
                comparisons = ()
            if (
                not comparisons
                or len(component.actions) != 1
                or len(component.else_actions) > 1
                or not isinstance(component.actions[0], RebalanceAction)
                or not isinstance(component.actions[0].targets, ComponentOutputExpression)
                or (
                    component.else_actions
                    and (
                        not isinstance(component.else_actions[0], RebalanceAction)
                        or not isinstance(component.else_actions[0].targets, ComponentOutputExpression)
                    )
                )
            ):
                raise StrategyDesugaringError(
                    "Predicate execution requires ALL-composed executable comparisons and one THEN rebalance"
                )
            target_ref = component.actions[0].targets
            otherwise_ref = (
                component.else_actions[0].targets if component.else_actions else None
            )
            if target_ref.port != "targets" or (
                otherwise_ref is not None and otherwise_ref.port != "targets"
            ):
                raise StrategyDesugaringError("predicate rebalance must reference targets outputs")
            operation = strategy_ir.PredicateRebalanceOp(
                id=component.id,
                asset=comparisons[0].left.asset or comparisons[0].right.asset or "",
                lookback_bars=comparisons[0].left.observations or comparisons[0].right.observations or 1,
                operator=comparisons[0].operator,
                threshold=comparisons[0].right.literal or Decimal(0),
                targets=target_ref.component_id,
                provenance=provenance,
                otherwise_targets=otherwise_ref.component_id if otherwise_ref is not None else None,
                comparisons=comparisons,
            )
        else:  # guarded by SUPPORTED_SOURCE_IMPLEMENTATIONS
            raise StrategyDesugaringError(f"unsupported source operation: {implementation}")
        operations.append(operation)

    return strategy_ir.StrategyIR(
        strategy_identity=strategy_hash(strategy),
        operations=tuple(operations),
        entrypoints=tuple(
            strategy_ir.IREntrypoint(
                event=item.event_component_id,
                target=item.target_component_id,
            )
            for item in strategy.entrypoints
        ),
        user_state=tuple(user_state),
    )


def _source_depends_on(
    component_id: str,
    ancestor_id: str,
    inputs: dict[tuple[str, str], list[str]],
) -> bool:
    if component_id == ancestor_id:
        return True
    upstream = {
        source for (target, _), sources in inputs.items() if target == component_id for source in sources
    }
    return any(_source_depends_on(source, ancestor_id, inputs) for source in upstream)
