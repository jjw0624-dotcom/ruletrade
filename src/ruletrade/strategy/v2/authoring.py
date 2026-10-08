"""Atomic Profile A v2 semantic authoring operations.

Frontend drafts are intentionally absent from this module.  Only complete,
validated semantic objects cross this boundary and every response is a complete
Canonical replacement.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Callable, Literal

from pydantic import Field

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.models import GroupDefinition, StrategyMetadata
from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind
from ruletrade.strategy.v2.models import (
    AllocationLegV2,
    AllocationStatementV2,
    AllocationTargetV2,
    AssetSetDefinitionV2,
    CanonicalStrategyV2,
    ComparisonV2,
    ConditionV2,
    ConditionalStatementV2,
    EventDefinitionV2,
    EventStatementV2,
    FormalizationProvenanceV2,
    GuardedAllocationStatementV2,
    Identifier,
    ProgramClockV2,
    ProgramStatementV2,
    RememberValueStatementV2,
    SelectionV2,
    SelectionStatementV2,
    SemanticProgramV2,
    StateTransitionStatementV2,
    StateTransitionV2,
    StrategyDefinitionsV2,
    UnresolvedStatementV2,
    Symbol,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.semantic_types import Axis, FrozenModel, Quantity, Unit
from ruletrade.strategy.v2.validation import v2_capabilities, validate_strategy_v2


class V2AuthoringError(ValueError):
    def __init__(self, code: str, message: str, *, path: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.path = path


class SetSelectionUniverse(FrozenModel):
    kind: Literal["set_selection_universe"]
    universe_id: Identifier


class SetEligibilityCondition(FrozenModel):
    kind: Literal["set_eligibility_condition"]
    condition: ConditionV2 | None


class SetRankingValue(FrozenModel):
    kind: Literal["set_ranking_value"]
    value: ValueExpressionV2


class SetRankingDirection(FrozenModel):
    kind: Literal["set_ranking_direction"]
    direction: Literal["ascending", "descending"]


class SetSelectionCount(FrozenModel):
    kind: Literal["set_selection_count"]
    count: Annotated[int, Field(ge=1, le=100)]


class SetShortagePolicy(FrozenModel):
    kind: Literal["set_shortage_policy"]
    shortage_policy: Literal["choose_all", "require_full"]


class SetSelectionFallback(FrozenModel):
    kind: Literal["set_selection_fallback"]
    fallback_asset: Symbol | None


class SetPredicate(FrozenModel):
    kind: Literal["set_predicate"]
    predicate: ConditionV2 | None


class SetSemanticProgram(FrozenModel):
    kind: Literal["set_semantic_program"]
    program: SemanticProgramV2


class ReplaceProgramStatement(FrozenModel):
    kind: Literal["replace_program_statement"]
    semantic_id: Identifier
    statement: ProgramStatementV2


class InsertProgramStatement(FrozenModel):
    kind: Literal["insert_program_statement"]
    statement: ProgramStatementV2
    parent_semantic_id: Identifier | None = None
    branch: Literal["root", "then", "otherwise", "event"] = "root"
    index: Annotated[int, Field(ge=0, le=200)] | None = None


class RemoveProgramStatement(FrozenModel):
    kind: Literal["remove_program_statement"]
    semantic_id: Identifier


class MoveProgramStatement(FrozenModel):
    kind: Literal["move_program_statement"]
    semantic_id: Identifier
    parent_semantic_id: Identifier | None = None
    branch: Literal["root", "then", "otherwise", "event"] = "root"
    index: Annotated[int, Field(ge=0, le=200)] | None = None


class SetProgramSelection(FrozenModel):
    kind: Literal["set_program_selection"]
    semantic_id: Identifier
    selection: SelectionV2


class SetProgramAssetSet(FrozenModel):
    kind: Literal["set_program_asset_set"]
    asset_set_id: Identifier
    assets: tuple[Symbol, ...] = Field(default=(), max_length=500)


class AddProgramInvestment(FrozenModel):
    kind: Literal["add_program_investment"]
    investment_id: Identifier
    name: str = Field(min_length=1, max_length=100)
    asset_set_id: Identifier
    assets: tuple[Symbol, ...] = Field(default=(), max_length=500)


class RemoveProgramInvestment(FrozenModel):
    kind: Literal["remove_program_investment"]
    investment_id: Identifier


class SetProgramSchedule(FrozenModel):
    kind: Literal["set_program_schedule"]
    clock_id: Identifier
    timeframe: Literal["daily", "weekly", "monthly"]


class CreateProgramSelection(FrozenModel):
    kind: Literal["create_program_selection"]
    semantic_id: Identifier
    investment_id: Identifier
    clock_id: Identifier
    lookback: Annotated[int, Field(ge=2, le=2000)]
    direction: Literal["ascending", "descending"]
    count: Annotated[int, Field(ge=1, le=100)]
    shortage_policy: Literal["choose_all", "require_full"]
    qualification_lookback: Annotated[int, Field(ge=2, le=2000)] | None = None
    qualification_operator: Literal["gt", "gte", "lt", "lte"] | None = None
    qualification_threshold: Decimal | None = None


class SetProgramFallback(FrozenModel):
    kind: Literal["set_program_fallback"]
    semantic_id: Identifier
    fallback_asset: Symbol | None


class SetProgramSplit(FrozenModel):
    kind: Literal["set_program_split"]
    semantic_id: Identifier = "portfolio-split"
    investments: tuple[tuple[Identifier, Decimal], ...] = Field(min_length=2, max_length=20)


class SetProgramCondition(FrozenModel):
    kind: Literal["set_program_condition"]
    semantic_id: Identifier
    role: Literal["control", "event", "transition", "selection_eligibility", "guard", "override"]
    condition: ConditionV2 | None
    override_semantic_id: Identifier | None = None


class SetProgramValue(FrozenModel):
    kind: Literal["set_program_value"]
    semantic_id: Identifier
    role: Literal["selection_ranking", "remembered_value"]
    value: ValueExpressionV2


class SetProgramEvent(FrozenModel):
    kind: Literal["set_program_event"]
    semantic_id: Identifier
    event: EventDefinitionV2


class SetProgramTransition(FrozenModel):
    kind: Literal["set_program_transition"]
    semantic_id: Identifier
    transition: StateTransitionV2


class SetProgramAllocation(FrozenModel):
    kind: Literal["set_program_allocation"]
    semantic_id: Identifier
    role: Literal["statement", "primary", "fallback", "override"] = "statement"
    allocation: AllocationStatementV2
    override_semantic_id: Identifier | None = None


class SetProgramFormalizations(FrozenModel):
    kind: Literal["set_program_formalizations"]
    formalizations: tuple[FormalizationProvenanceV2, ...] = Field(max_length=100)


class FormalizeProgramStatement(FrozenModel):
    kind: Literal["formalize_program_statement"]
    semantic_id: Identifier
    replacement: ProgramStatementV2
    interpretation: str = Field(min_length=1, max_length=1000)


class FormalizeDraftPhrase(FrozenModel):
    kind: Literal["formalize_draft_phrase"]
    source_phrase: str = Field(min_length=1, max_length=500)
    replacement: ProgramStatementV2
    interpretation: str = Field(min_length=1, max_length=1000)
    parent_semantic_id: Identifier | None = None
    branch: Literal["root", "then", "otherwise", "event"] = "root"
    index: Annotated[int, Field(ge=0, le=200)] | None = None


V2AuthoringOperation = Annotated[
    SetSelectionUniverse
    | SetEligibilityCondition
    | SetRankingValue
    | SetRankingDirection
    | SetSelectionCount
    | SetShortagePolicy
    | SetSelectionFallback
    | SetPredicate
    | SetSemanticProgram
    | ReplaceProgramStatement
    | InsertProgramStatement
    | RemoveProgramStatement
    | MoveProgramStatement
    | SetProgramSelection
    | SetProgramAssetSet
    | AddProgramInvestment
    | RemoveProgramInvestment
    | SetProgramSchedule
    | CreateProgramSelection
    | SetProgramFallback
    | SetProgramSplit
    | SetProgramCondition
    | SetProgramValue
    | SetProgramEvent
    | SetProgramTransition
    | SetProgramAllocation
    | SetProgramFormalizations
    | FormalizeProgramStatement
    | FormalizeDraftPhrase,
    Field(discriminator="kind"),
]


class ApplyV2AuthoringRequest(FrozenModel):
    strategy: CanonicalStrategyV2
    expected_source_hash: str
    operation: V2AuthoringOperation


class ApplyV2AuthoringResponse(FrozenModel):
    strategy: CanonicalStrategyV2
    source_hash: str


class ProgramStrategyTemplateRequest(FrozenModel):
    name: str = Field(min_length=1, max_length=100)
    assets: tuple[Symbol, ...] = ("SPY",)
    starting_point: Literal["fallback", "sleeves", "cooldown", "one_investment", "filter", "golden"] | None = None


def create_program_strategy_template(request: ProgramStrategyTemplateRequest) -> CanonicalStrategyV2:
    """Create a Program-native document; compatibility Selection is never synthesized."""
    if len(set(request.assets)) != len(request.assets):
        raise V2AuthoringError("duplicate_template_asset", "Program template assets must be unique.")
    strategy = CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name=request.name),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinitionV2(id="initial-assets", assets=list(request.assets)),),
            groups=(),
            asset_axis=Axis(name="asset", domain_id="initial-assets", coordinate_policy="member_identity"),
        ),
        operator_lock={"compare": "1"},
        selection=None,
        predicate=None,
        program=SemanticProgramV2(
            semantic_id="program",
            clocks=(ProgramClockV2(id="daily-close", timeframe="daily"),),
            statements=(AllocationStatementV2(
                semantic_id="initial-retain-allocation",
                method="equal",
                legs=(AllocationLegV2(
                    semantic_id="initial-retain-leg",
                    target=AllocationTargetV2(semantic_id="initial-retain-target", kind="retain"),
                ),),
                clock_id="daily-close",
            ),),
        ),
    )
    if request.starting_point is None:
        return strategy

    def authored(operation: V2AuthoringOperation) -> CanonicalStrategyV2:
        nonlocal strategy
        strategy = apply_v2_authoring(ApplyV2AuthoringRequest(
            strategy=strategy,
            expected_source_hash=strategy_hash(strategy),
            operation=operation,
        )).strategy
        return strategy

    if request.starting_point == "one_investment":
        authored(AddProgramInvestment(
            kind="add_program_investment", investment_id="investment", name="Investment",
            asset_set_id="investment-assets", assets=("QQQ",),
        ))
        authored(SetProgramSchedule(kind="set_program_schedule", clock_id="daily-close", timeframe="monthly"))
        return strategy

    if request.starting_point == "cooldown":
        authored(AddProgramInvestment(
            kind="add_program_investment", investment_id="investment", name="Investment",
            asset_set_id="investment-assets", assets=("QQQ", "IEF"),
        ))
        return strategy.model_copy(update={"program": strategy.program.model_copy(update={
            "statements": strategy.program.statements + (UnresolvedStatementV2(
                semantic_id="cooldown-policy", source_text="Wait 20 completed trading days before re-entry",
                category="unsupported_semantics",
                reason="Cooldown remains available only through the historical V1 compatibility engine.",
            ),),
        })})

    growth_assets = ("QQQ", "VGT", "SOXX", "SCHG")
    authored(AddProgramInvestment(
        kind="add_program_investment", investment_id="growth", name="Growth" if request.starting_point in {"sleeves", "golden"} else "Investment",
        asset_set_id="growth-assets", assets=growth_assets,
    ))
    if request.starting_point in {"sleeves", "golden"}:
        authored(AddProgramInvestment(
            kind="add_program_investment", investment_id="defensive", name="Defensive",
            asset_set_id="defensive-assets", assets=("TLT", "IEF"),
        ))
    authored(CreateProgramSelection(
        kind="create_program_selection", semantic_id="growth-selection",
        investment_id="growth", clock_id="daily-close", lookback=126,
        direction="descending", count=2, shortage_policy="require_full",
        qualification_lookback=126, qualification_operator="gt", qualification_threshold=Decimal(0),
    ))
    if request.starting_point in {"fallback", "sleeves"}:
        authored(SetProgramFallback(kind="set_program_fallback", semantic_id="growth-selection", fallback_asset="TLT"))
    if request.starting_point in {"sleeves", "golden"}:
        authored(SetProgramSplit(
            kind="set_program_split",
            investments=(("growth", Decimal("0.70")), ("defensive", Decimal("0.30"))),
        ))
    authored(SetProgramSchedule(kind="set_program_schedule", clock_id="daily-close", timeframe="monthly"))
    return strategy


class V2AuthoringCapability(FrozenModel):
    operation_id: str
    label: str
    available: bool
    reason: str | None = None
    semantic_status: Literal["executable", "reference_only", "unavailable"] = "unavailable"
    reference_evaluable: bool = False
    backend_lowerable: bool = False
    authoring_reachable: bool = False
    production_ready: bool = False


def authoring_capabilities() -> tuple[V2AuthoringCapability, ...]:
    ledger = v2_capabilities()
    values = (
        ("daily.adjusted_close@1", "Current adjusted close"),
        ("daily.trailing_return@1", "Trailing return"),
        ("daily.sma@1", "Simple moving average"),
        ("daily.ema@1", "Exponential moving average"),
        ("daily.rsi_wilder_lean_compat@1", "RSI"),
        ("daily.realized_volatility@1", "Realized volatility"),
        ("daily.volume_raw_shares@1", "Volume"),
        ("daily.raw_ohlc@1", "Raw OHLC"),
    )
    value_capabilities = tuple(
        V2AuthoringCapability(
            operation_id=operation_id,
            label=label,
            available=(ledger[operation_id].provider_available and ledger[operation_id].backend_lowerable and ledger[operation_id].verified_profile),
            reason=None if (ledger[operation_id].provider_available and ledger[operation_id].backend_lowerable and ledger[operation_id].verified_profile) else (
                "Unavailable with the maintained data provider."
                if not ledger[operation_id].provider_available
                else "Known semantic operation; executable authoring is not yet available."
            ),
            semantic_status="executable" if (ledger[operation_id].provider_available and ledger[operation_id].backend_lowerable and ledger[operation_id].verified_profile) else "unavailable",
            reference_evaluable=ledger[operation_id].reference_evaluable,
            backend_lowerable=ledger[operation_id].backend_lowerable,
            authoring_reachable=ledger[operation_id].authoring_reachable,
            production_ready=ledger[operation_id].production_ready,
        )
        for operation_id, label in values
    )
    program_capabilities = tuple(V2AuthoringCapability(
        operation_id=operation_id,
        label=label,
        available=True,
        reason=(
            "Semantically defined and reference-evaluable, but not exposed in the product Builder."
            if operation_id in {"program.event@1", "program.state@1"}
            else "Authorable and reference-evaluable; production execution lowering is not available."
        ),
        semantic_status="reference_only",
        reference_evaluable=True,
        backend_lowerable=False,
        authoring_reachable=operation_id not in {"program.event@1", "program.state@1"},
        production_ready=False,
    ) for operation_id, label in (
        ("program.cross_sectional@1", "Cross-sectional rank, percentile, quantile and bucket"),
        ("program.score@1", "Weighted and condition-based score"),
        ("program.event@1", "Event semantics"),
        ("program.state@1", "State and transition semantics"),
        ("program.allocation@1", "Allocation and policy precedence"),
        ("program.formalization@1", "Explicit fuzzy-term formalization"),
    ))
    return value_capabilities + program_capabilities


def _replace_program_statement(
    program: SemanticProgramV2,
    semantic_id: str,
    replacement: ProgramStatementV2,
) -> SemanticProgramV2:
    from ruletrade.strategy.v2.models import (
        AllocationStatementV2,
        ConditionalStatementV2,
        EventStatementV2,
        GuardedAllocationStatementV2,
    )

    matches = 0

    def visit(statement: ProgramStatementV2) -> ProgramStatementV2:
        nonlocal matches
        if statement.semantic_id == semantic_id:
            matches += 1
            return replacement
        if isinstance(statement, ConditionalStatementV2):
            return statement.model_copy(update={
                "then_statements": tuple(visit(item) for item in statement.then_statements),
                "otherwise_statements": tuple(visit(item) for item in statement.otherwise_statements),
            })
        if isinstance(statement, EventStatementV2):
            return statement.model_copy(update={
                "statements": tuple(visit(item) for item in statement.statements),
            })
        if isinstance(statement, GuardedAllocationStatementV2):
            def allocation(item: AllocationStatementV2) -> AllocationStatementV2:
                nonlocal matches
                if item.semantic_id != semantic_id:
                    return item
                matches += 1
                if not isinstance(replacement, AllocationStatementV2):
                    raise V2AuthoringError(
                        "program_statement_kind_mismatch",
                        "A nested Allocation address requires an Allocation replacement.",
                    )
                return replacement

            return statement.model_copy(update={
                "primary": allocation(statement.primary),
                "overrides": tuple(override.model_copy(update={
                    "action": allocation(override.action),
                }) for override in statement.overrides),
                "fallback": None if statement.fallback is None else allocation(statement.fallback),
            })
        return statement

    changed = program.model_copy(update={
        "statements": tuple(visit(item) for item in program.statements),
    })
    if matches == 0:
        raise V2AuthoringError(
            "program_statement_not_found",
            f"No Program statement has semantic id {semantic_id!r}.",
        )
    if matches > 1:
        raise V2AuthoringError(
            "ambiguous_program_address",
            f"Program semantic id {semantic_id!r} is not unique.",
        )
    return SemanticProgramV2.model_validate(changed)


def _rewrite_program_statements(
    program: SemanticProgramV2,
    rewrite: Callable[[ProgramStatementV2], ProgramStatementV2 | None],
) -> SemanticProgramV2:
    """Rewrite by semantic identity while preserving unrelated addresses/order."""

    def visit(statement: ProgramStatementV2) -> ProgramStatementV2 | None:
        current = rewrite(statement)
        if current is None:
            return None
        if isinstance(current, ConditionalStatementV2):
            current = current.model_copy(update={
                "then_statements": tuple(
                    item for child in current.then_statements if (item := visit(child)) is not None
                ),
                "otherwise_statements": tuple(
                    item for child in current.otherwise_statements if (item := visit(child)) is not None
                ),
            })
        elif isinstance(current, EventStatementV2):
            current = current.model_copy(update={
                "statements": tuple(
                    item for child in current.statements if (item := visit(child)) is not None
                ),
            })
        return current

    return SemanticProgramV2.model_validate(program.model_copy(update={
        "statements": tuple(
            item for statement in program.statements if (item := visit(statement)) is not None
        ),
    }))


def _edit_program_statement(
    program: SemanticProgramV2,
    semantic_id: str,
    edit: Callable[[ProgramStatementV2], ProgramStatementV2],
) -> SemanticProgramV2:
    matches = 0

    def rewrite(statement: ProgramStatementV2) -> ProgramStatementV2:
        nonlocal matches
        if statement.semantic_id != semantic_id:
            return statement
        matches += 1
        return edit(statement)

    changed = _rewrite_program_statements(program, rewrite)
    if matches == 0:
        raise V2AuthoringError("program_statement_not_found", f"No Program statement has semantic id {semantic_id!r}.")
    if matches > 1:
        raise V2AuthoringError("ambiguous_program_address", f"Program semantic id {semantic_id!r} is not unique.")
    return changed


def _insert_program_statement(
    program: SemanticProgramV2,
    statement: ProgramStatementV2,
    *,
    parent_semantic_id: str | None,
    branch: str,
    index: int | None,
) -> SemanticProgramV2:
    def inserted(items: tuple[ProgramStatementV2, ...]) -> tuple[ProgramStatementV2, ...]:
        position = len(items) if index is None else min(index, len(items))
        return items[:position] + (statement,) + items[position:]

    if parent_semantic_id is None:
        if branch != "root":
            raise V2AuthoringError("program_parent_required", f"Branch {branch!r} requires a parent semantic address.")
        return SemanticProgramV2.model_validate(program.model_copy(update={"statements": inserted(program.statements)}))

    def edit(parent: ProgramStatementV2) -> ProgramStatementV2:
        if branch in {"then", "otherwise"} and isinstance(parent, ConditionalStatementV2):
            field = "then_statements" if branch == "then" else "otherwise_statements"
            return parent.model_copy(update={field: inserted(getattr(parent, field))})
        if branch == "event" and isinstance(parent, EventStatementV2):
            return parent.model_copy(update={"statements": inserted(parent.statements)})
        raise V2AuthoringError(
            "program_branch_incompatible",
            f"{parent.kind!r} cannot own the {branch!r} Program branch.",
        )

    return _edit_program_statement(program, parent_semantic_id, edit)


def _remove_program_statement(
    program: SemanticProgramV2,
    semantic_id: str,
) -> tuple[SemanticProgramV2, ProgramStatementV2]:
    matches: list[ProgramStatementV2] = []

    def rewrite(statement: ProgramStatementV2) -> ProgramStatementV2 | None:
        if statement.semantic_id == semantic_id:
            matches.append(statement)
            return None
        return statement

    try:
        changed = _rewrite_program_statements(program, rewrite)
    except ValueError as exc:
        raise V2AuthoringError(
            "program_removal_incomplete",
            "Removing this statement would leave an incomplete Program branch.",
        ) from exc
    if not matches:
        raise V2AuthoringError("program_statement_not_found", f"No Program statement has semantic id {semantic_id!r}.")
    if len(matches) > 1:
        raise V2AuthoringError("ambiguous_program_address", f"Program semantic id {semantic_id!r} is not unique.")
    return changed, matches[0]


def _program_for_operation(
    strategy: CanonicalStrategyV2,
    operation: V2AuthoringOperation,
) -> SemanticProgramV2:
    if strategy.program is None:
        raise V2AuthoringError(
            "semantic_program_missing",
            f"{operation.kind} requires a Program-native Strategy.",
        )
    return strategy.program


def _apply_program_operation(
    strategy: CanonicalStrategyV2,
    operation: V2AuthoringOperation,
) -> CanonicalStrategyV2 | None:
    if isinstance(operation, SetSemanticProgram):
        return strategy.model_copy(update={"program": operation.program})
    if not isinstance(operation, (
        ReplaceProgramStatement, InsertProgramStatement, RemoveProgramStatement,
        MoveProgramStatement, SetProgramSelection, SetProgramCondition,
        SetProgramAssetSet, AddProgramInvestment, RemoveProgramInvestment, SetProgramSchedule,
        CreateProgramSelection, SetProgramFallback, SetProgramSplit,
        SetProgramValue, SetProgramEvent, SetProgramTransition,
        SetProgramAllocation, SetProgramFormalizations,
        FormalizeProgramStatement, FormalizeDraftPhrase,
    )):
        return None
    if isinstance(operation, SetProgramAssetSet):
        if len(set(operation.assets)) != len(operation.assets):
            raise V2AuthoringError("duplicate_asset", "Each asset can appear only once in this investment.")
        found = False
        asset_sets = []
        for asset_set in strategy.definitions.asset_sets:
            if asset_set.id == operation.asset_set_id:
                found = True
                asset_set = asset_set.model_copy(update={"assets": list(operation.assets)})
            asset_sets.append(asset_set)
        if not found:
            raise V2AuthoringError("asset_set_not_found", "This investment's asset list no longer exists.")
        definitions = strategy.definitions.model_copy(update={"asset_sets": tuple(asset_sets)})
        return strategy.model_copy(update={"definitions": definitions})
    if isinstance(operation, AddProgramInvestment):
        if any(group.id == operation.investment_id for group in strategy.definitions.groups):
            raise V2AuthoringError("investment_exists", "This investment already exists.")
        if any(asset_set.id == operation.asset_set_id for asset_set in strategy.definitions.asset_sets):
            raise V2AuthoringError("asset_set_exists", "This investment asset list already exists.")
        if len(set(operation.assets)) != len(operation.assets):
            raise V2AuthoringError("duplicate_asset", "Each asset can appear only once in this investment.")
        asset_set = AssetSetDefinitionV2(id=operation.asset_set_id, assets=list(operation.assets))
        group = GroupDefinition(id=operation.investment_id, name=operation.name, asset_set_ref=operation.asset_set_id)
        definitions = strategy.definitions.model_copy(update={
            "asset_sets": strategy.definitions.asset_sets + (asset_set,),
            "groups": strategy.definitions.groups + (group,),
            "asset_axis": Axis(name="asset", domain_id=operation.investment_id, coordinate_policy="member_identity"),
        })
        return strategy.model_copy(update={"definitions": definitions})
    if isinstance(operation, RemoveProgramInvestment):
        program = _program_for_operation(strategy, operation)
        group = next((item for item in strategy.definitions.groups if item.id == operation.investment_id), None)
        if group is None:
            raise V2AuthoringError("investment_not_found", "This investment no longer exists.")
        if any(isinstance(item, SelectionStatementV2) and item.selection.universe_id == group.id for item in program.statements):
            raise V2AuthoringError("investment_in_use", "Remove this investment's selection before removing the investment.")
        groups = tuple(item for item in strategy.definitions.groups if item.id != group.id)
        asset_sets = tuple(item for item in strategy.definitions.asset_sets if item.id != group.asset_set_ref)
        if not asset_sets:
            raise V2AuthoringError("last_asset_set", "The Builder must retain one asset list.")
        domain_id = groups[0].id if groups else asset_sets[0].id
        definitions = strategy.definitions.model_copy(update={
            "asset_sets": asset_sets, "groups": groups,
            "asset_axis": Axis(name="asset", domain_id=domain_id, coordinate_policy="member_identity"),
        })
        return strategy.model_copy(update={"definitions": definitions})
    if isinstance(operation, SetProgramSchedule):
        current_program = _program_for_operation(strategy, operation)
        found = False
        clocks = []
        for clock in current_program.clocks:
            if clock.id == operation.clock_id:
                found = True
                clock = clock.model_copy(update={"timeframe": operation.timeframe})
            clocks.append(clock)
        if not found:
            raise V2AuthoringError("program_clock_not_found", "This rebalance schedule no longer exists.")
        program = current_program.model_copy(update={"clocks": tuple(clocks)})
        return strategy.model_copy(update={"program": program})
    if isinstance(operation, CreateProgramSelection):
        current_program = _program_for_operation(strategy, operation)
        if not any(group.id == operation.investment_id for group in strategy.definitions.groups):
            raise V2AuthoringError("investment_not_found", "The addressed Investment does not exist.")
        if any(isinstance(item, SelectionStatementV2) and item.selection.universe_id == operation.investment_id for item in current_program.statements):
            raise V2AuthoringError("selection_exists", "This Investment already has a Selection.")
        if not any(clock.id == operation.clock_id for clock in current_program.clocks):
            raise V2AuthoringError("program_clock_not_found", "The addressed schedule does not exist.")
        binding_id = f"{operation.semantic_id}-candidate"
        def candidate_return(prefix: str, lookback: int) -> DailyValueNode:
            source = DailyValueNode(
                semantic_id=f"{prefix}-close", kind="observe", subject_kind=SubjectKind.CANDIDATE,
                binding_id=binding_id, field=MarketField.CLOSE, basis=PriceBasis.ADJUSTED,
            )
            return DailyValueNode(semantic_id=f"{prefix}-return", kind="trailing_return", operands=(source,), observations=lookback)
        eligibility = None
        qualification_fields = (operation.qualification_lookback, operation.qualification_operator, operation.qualification_threshold)
        if any(value is not None for value in qualification_fields):
            if any(value is None for value in qualification_fields):
                raise V2AuthoringError("incomplete_qualification", "Qualification requires lookback, operator, and threshold together.")
            eligibility = ComparisonV2(
                semantic_id=f"{operation.semantic_id}-qualification",
                operator=operation.qualification_operator,
                left=candidate_return(f"{operation.semantic_id}-qualification", operation.qualification_lookback),
                right=DailyValueNode(
                    semantic_id=f"{operation.semantic_id}-threshold", kind="literal",
                    quantity=Quantity.RETURN, unit=Unit.RATIO,
                    refinement="trailing_return:adjusted_close", value=operation.qualification_threshold,
                ),
            )
        output_id = f"{operation.semantic_id}-output"
        statement = SelectionStatementV2(
            semantic_id=operation.semantic_id,
            output_id=output_id,
            clock_id=operation.clock_id,
            selection=SelectionV2(
                semantic_id=f"{operation.semantic_id}-definition",
                universe_id=operation.investment_id,
                binding={"id": binding_id, "domain_id": operation.investment_id},
                eligibility=eligibility,
                ranking=candidate_return(operation.semantic_id, operation.lookback),
                direction=operation.direction,
                count=operation.count,
                shortage_policy=operation.shortage_policy,
            ),
        )
        allocation_id = f"allocation-{operation.semantic_id}"
        allocation = AllocationStatementV2(
            semantic_id=allocation_id, method="equal", clock_id=operation.clock_id,
            legs=(AllocationLegV2(
                semantic_id=f"{allocation_id}-leg",
                target=AllocationTargetV2(
                    semantic_id=f"{allocation_id}-target", kind="selection", ref=output_id,
                ),
            ),),
        )
        program = current_program.model_copy(update={"statements": current_program.statements + (statement, allocation)})
        return strategy.model_copy(update={"program": program})
    if isinstance(operation, SetProgramFallback):
        program = _program_for_operation(strategy, operation)
        def fallback(statement: ProgramStatementV2) -> ProgramStatementV2:
            if not isinstance(statement, SelectionStatementV2):
                raise V2AuthoringError("program_role_mismatch", "Fallback belongs to a Selection.")
            return statement.model_copy(update={"selection": statement.selection.model_copy(update={"fallback_asset": operation.fallback_asset})})
        return strategy.model_copy(update={"program": _edit_program_statement(program, operation.semantic_id, fallback)})
    if isinstance(operation, SetProgramSplit):
        program = _program_for_operation(strategy, operation)
        known = {group.id for group in strategy.definitions.groups}
        if any(investment_id not in known for investment_id, _weight in operation.investments):
            raise V2AuthoringError("investment_not_found", "Every Split target must be an existing Investment.")
        if sum((weight for _investment_id, weight in operation.investments), Decimal(0)) != Decimal(1):
            raise V2AuthoringError("invalid_split_total", "Split weights must sum exactly to 1.")
        split = AllocationStatementV2(
            semantic_id=operation.semantic_id, method="fixed", clock_id=program.clocks[0].id,
            legs=tuple(AllocationLegV2(
                semantic_id=f"{operation.semantic_id}-leg-{index + 1}", weight=weight,
                target=AllocationTargetV2(
                    semantic_id=f"{operation.semantic_id}-target-{index + 1}", kind="group", ref=investment_id,
                ),
            ) for index, (investment_id, weight) in enumerate(operation.investments)),
        )
        statements = tuple(item for item in program.statements if not (
            isinstance(item, AllocationStatementV2) and item.method == "fixed"
            and len(item.legs) > 1 and all(leg.target.kind == "group" for leg in item.legs)
        )) + (split,)
        return strategy.model_copy(update={"program": program.model_copy(update={"statements": statements})})
    program = _program_for_operation(strategy, operation)
    if isinstance(operation, ReplaceProgramStatement):
        if operation.statement.semantic_id != operation.semantic_id:
            raise V2AuthoringError("program_identity_change", "Replacing a statement must preserve its semantic id.")
        program = _replace_program_statement(program, operation.semantic_id, operation.statement)
    elif isinstance(operation, InsertProgramStatement):
        program = _insert_program_statement(
            program, operation.statement,
            parent_semantic_id=operation.parent_semantic_id,
            branch=operation.branch,
            index=operation.index,
        )
    elif isinstance(operation, RemoveProgramStatement):
        program, _removed = _remove_program_statement(program, operation.semantic_id)
    elif isinstance(operation, MoveProgramStatement):
        without, removed = _remove_program_statement(program, operation.semantic_id)
        program = _insert_program_statement(
            without, removed,
            parent_semantic_id=operation.parent_semantic_id,
            branch=operation.branch,
            index=operation.index,
        )
    elif isinstance(operation, SetProgramFormalizations):
        program = SemanticProgramV2.model_validate(program.model_copy(update={
            "formalizations": operation.formalizations,
        }))
    elif isinstance(operation, FormalizeProgramStatement):
        unresolved: UnresolvedStatementV2 | None = None
        def formalize(statement: ProgramStatementV2) -> ProgramStatementV2:
            nonlocal unresolved
            if not isinstance(statement, UnresolvedStatementV2):
                raise V2AuthoringError("program_role_mismatch", "Only an unresolved statement can be formalized.")
            unresolved = statement
            return operation.replacement
        program = _edit_program_statement(program, operation.semantic_id, formalize)
        assert unresolved is not None
        provenance = FormalizationProvenanceV2(
            source_phrase=unresolved.source_text,
            status="formalized",
            semantic_ids=(operation.replacement.semantic_id,),
            interpretation=operation.interpretation,
        )
        program = SemanticProgramV2.model_validate(program.model_copy(update={
            "formalizations": program.formalizations + (provenance,),
        }))
    elif isinstance(operation, FormalizeDraftPhrase):
        program = _insert_program_statement(
            program, operation.replacement,
            parent_semantic_id=operation.parent_semantic_id,
            branch=operation.branch,
            index=operation.index,
        )
        provenance = FormalizationProvenanceV2(
            source_phrase=operation.source_phrase,
            status="formalized",
            semantic_ids=(operation.replacement.semantic_id,),
            interpretation=operation.interpretation,
        )
        program = SemanticProgramV2.model_validate(program.model_copy(update={
            "formalizations": program.formalizations + (provenance,),
        }))
    elif isinstance(operation, SetProgramSelection):
        def selection(statement: ProgramStatementV2) -> ProgramStatementV2:
            if not isinstance(statement, SelectionStatementV2):
                raise V2AuthoringError("program_role_mismatch", "This address is not a Selection statement.")
            if operation.selection.semantic_id != statement.selection.semantic_id:
                raise V2AuthoringError("program_identity_change", "Selection editing must preserve semantic identity.")
            return statement.model_copy(update={"selection": operation.selection})
        program = _edit_program_statement(program, operation.semantic_id, selection)
    elif isinstance(operation, SetProgramValue):
        def value(statement: ProgramStatementV2) -> ProgramStatementV2:
            if operation.role == "selection_ranking" and isinstance(statement, SelectionStatementV2):
                if operation.value.semantic_id != statement.selection.ranking.semantic_id:
                    raise V2AuthoringError("program_identity_change", "Ranking editing must preserve semantic identity.")
                return statement.model_copy(update={
                    "selection": statement.selection.model_copy(update={"ranking": operation.value}),
                })
            if operation.role == "remembered_value" and isinstance(statement, RememberValueStatementV2):
                if operation.value.semantic_id != statement.value.semantic_id:
                    raise V2AuthoringError("program_identity_change", "Remembered Value editing must preserve semantic identity.")
                return statement.model_copy(update={"value": operation.value})
            raise V2AuthoringError("program_role_mismatch", f"{operation.role} is invalid for this statement.")
        program = _edit_program_statement(program, operation.semantic_id, value)
    elif isinstance(operation, SetProgramEvent):
        def event(statement: ProgramStatementV2) -> ProgramStatementV2:
            if not isinstance(statement, EventStatementV2):
                raise V2AuthoringError("program_role_mismatch", "This address is not an Event statement.")
            if operation.event.semantic_id != statement.event.semantic_id:
                raise V2AuthoringError("program_identity_change", "Event editing must preserve semantic identity.")
            return statement.model_copy(update={"event": operation.event})
        program = _edit_program_statement(program, operation.semantic_id, event)
    elif isinstance(operation, SetProgramTransition):
        def transition(statement: ProgramStatementV2) -> ProgramStatementV2:
            if not isinstance(statement, StateTransitionStatementV2):
                raise V2AuthoringError("program_role_mismatch", "This address is not a State transition.")
            if operation.transition.semantic_id != statement.transition.semantic_id:
                raise V2AuthoringError("program_identity_change", "State transition editing must preserve semantic identity.")
            return statement.model_copy(update={"transition": operation.transition})
        program = _edit_program_statement(program, operation.semantic_id, transition)
    elif isinstance(operation, SetProgramCondition):
        def condition(statement: ProgramStatementV2) -> ProgramStatementV2:
            if operation.role == "control" and isinstance(statement, ConditionalStatementV2) and operation.condition is not None:
                return statement.model_copy(update={"condition": operation.condition})
            if operation.role == "event" and isinstance(statement, EventStatementV2):
                return statement.model_copy(update={"event": statement.event.model_copy(update={"condition": operation.condition})})
            if operation.role == "transition" and isinstance(statement, StateTransitionStatementV2) and operation.condition is not None:
                return statement.model_copy(update={"transition": statement.transition.model_copy(update={"when": operation.condition})})
            if operation.role == "selection_eligibility" and isinstance(statement, SelectionStatementV2):
                return statement.model_copy(update={"selection": statement.selection.model_copy(update={"eligibility": operation.condition})})
            if operation.role == "guard" and isinstance(statement, GuardedAllocationStatementV2):
                return statement.model_copy(update={"guard": operation.condition})
            if operation.role == "override" and isinstance(statement, GuardedAllocationStatementV2) and operation.condition is not None:
                if operation.override_semantic_id is None:
                    raise V2AuthoringError("override_address_required", "Override editing requires an override semantic id.")
                found = False
                overrides = []
                for rule in statement.overrides:
                    if rule.semantic_id == operation.override_semantic_id:
                        found = True
                        rule = rule.model_copy(update={"when": operation.condition})
                    overrides.append(rule)
                if not found:
                    raise V2AuthoringError("override_not_found", "The addressed override does not exist.")
                return statement.model_copy(update={"overrides": tuple(overrides)})
            raise V2AuthoringError("program_role_mismatch", f"{operation.role} is invalid for this statement.")
        program = _edit_program_statement(program, operation.semantic_id, condition)
    elif isinstance(operation, SetProgramAllocation):
        def allocation(statement: ProgramStatementV2) -> ProgramStatementV2:
            if operation.role == "statement" and isinstance(statement, AllocationStatementV2):
                if operation.allocation.semantic_id != statement.semantic_id:
                    raise V2AuthoringError("program_identity_change", "Allocation editing must preserve semantic identity.")
                return operation.allocation
            if not isinstance(statement, GuardedAllocationStatementV2):
                raise V2AuthoringError("program_role_mismatch", "This address does not own an Allocation policy.")
            if operation.role == "primary":
                if operation.allocation.semantic_id != statement.primary.semantic_id:
                    raise V2AuthoringError("program_identity_change", "Primary policy editing must preserve semantic identity.")
                return statement.model_copy(update={"primary": operation.allocation})
            if operation.role == "fallback":
                if statement.fallback is not None and operation.allocation.semantic_id != statement.fallback.semantic_id:
                    raise V2AuthoringError("program_identity_change", "Fallback policy editing must preserve semantic identity.")
                return statement.model_copy(update={"fallback": operation.allocation})
            if operation.role == "override":
                if operation.override_semantic_id is None:
                    raise V2AuthoringError("override_address_required", "Override editing requires an override semantic id.")
                found = False
                overrides = []
                for rule in statement.overrides:
                    if rule.semantic_id == operation.override_semantic_id:
                        found = True
                        if operation.allocation.semantic_id != rule.action.semantic_id:
                            raise V2AuthoringError("program_identity_change", "Override action editing must preserve semantic identity.")
                        rule = rule.model_copy(update={"action": operation.allocation})
                    overrides.append(rule)
                if not found:
                    raise V2AuthoringError("override_not_found", "The addressed override does not exist.")
                return statement.model_copy(update={"overrides": tuple(overrides)})
            raise V2AuthoringError("program_role_mismatch", f"{operation.role} is invalid for this statement.")
        program = _edit_program_statement(program, operation.semantic_id, allocation)
    return strategy.model_copy(update={"program": program})


def apply_v2_authoring(request: ApplyV2AuthoringRequest) -> ApplyV2AuthoringResponse:
    current_hash = strategy_hash(request.strategy)
    if current_hash != request.expected_source_hash:
        raise V2AuthoringError(
            "stale_authoring_source",
            "Strategy changed after this editor request was created.",
        )

    operation = request.operation
    program_candidate = _apply_program_operation(request.strategy, operation)
    if program_candidate is not None:
        candidate = program_candidate
        issues = validate_strategy_v2(candidate)
        if issues:
            first = issues[0]
            raise V2AuthoringError(first.code, first.message, path=first.path)
        return ApplyV2AuthoringResponse(strategy=candidate, source_hash=strategy_hash(candidate))

    selection = request.strategy.selection
    selection_operations = (
        SetSelectionUniverse, SetEligibilityCondition, SetRankingValue,
        SetRankingDirection, SetSelectionCount, SetShortagePolicy,
        SetSelectionFallback,
    )
    if isinstance(operation, selection_operations) and selection is None:
        raise V2AuthoringError(
            "compatibility_selection_missing",
            "This Strategy is Program-native; address a Program statement instead.",
        )
    if isinstance(operation, SetSelectionUniverse):
        selection = selection.model_copy(update={
            "universe_id": operation.universe_id,
            "binding": selection.binding.model_copy(update={"domain_id": operation.universe_id}),
        })
    elif isinstance(operation, SetEligibilityCondition):
        selection = selection.model_copy(update={"eligibility": operation.condition})
    elif isinstance(operation, SetRankingValue):
        selection = selection.model_copy(update={"ranking": operation.value})
    elif isinstance(operation, SetRankingDirection):
        selection = selection.model_copy(update={"direction": operation.direction})
    elif isinstance(operation, SetSelectionCount):
        selection = selection.model_copy(update={"count": operation.count})
    elif isinstance(operation, SetShortagePolicy):
        selection = selection.model_copy(update={"shortage_policy": operation.shortage_policy})
    elif isinstance(operation, SetSelectionFallback):
        selection = selection.model_copy(update={"fallback_asset": operation.fallback_asset})

    if isinstance(operation, SetPredicate):
        candidate = request.strategy.model_copy(update={"predicate": operation.predicate})
    else:
        candidate = request.strategy.model_copy(update={"selection": SelectionV2.model_validate(selection)})

    issues = validate_strategy_v2(candidate)
    if issues:
        first = issues[0]
        raise V2AuthoringError(first.code, first.message, path=first.path)
    return ApplyV2AuthoringResponse(strategy=candidate, source_hash=strategy_hash(candidate))
