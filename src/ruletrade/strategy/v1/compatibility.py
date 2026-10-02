from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable


class StatementFamily(StrEnum):
    SELECTION = "selection"
    ALLOCATION = "allocation"
    ACTION = "action"
    CONSTRAINT = "constraint"
    TIMING = "timing"
    CONTROL = "control"
    SELECTION_FALLBACK = "selection_fallback"


class BranchSupport(StrEnum):
    SUPPORTED_IN_CONTROL_BRANCH = "supported_in_control_branch"
    DRAFTABLE_ONLY = "draftable_only"
    INVALID_IN_CONTROL_BRANCH = "invalid_in_control_branch"


class SemanticEffect(StrEnum):
    NONE = "none"
    CANDIDATES = "candidates"
    TARGETS = "targets"
    EXECUTION = "execution"


@dataclass(frozen=True)
class StatementContract:
    family: StatementFamily
    support: BranchSupport
    consumes: SemanticEffect
    produces: SemanticEffect


CONTRACTS: dict[StatementFamily, StatementContract] = {
    StatementFamily.SELECTION: StatementContract(
        StatementFamily.SELECTION,
        BranchSupport.SUPPORTED_IN_CONTROL_BRANCH,
        SemanticEffect.NONE,
        SemanticEffect.CANDIDATES,
    ),
    StatementFamily.ALLOCATION: StatementContract(
        StatementFamily.ALLOCATION,
        BranchSupport.SUPPORTED_IN_CONTROL_BRANCH,
        SemanticEffect.CANDIDATES,
        SemanticEffect.TARGETS,
    ),
    StatementFamily.ACTION: StatementContract(
        StatementFamily.ACTION,
        BranchSupport.SUPPORTED_IN_CONTROL_BRANCH,
        SemanticEffect.TARGETS,
        SemanticEffect.EXECUTION,
    ),
    StatementFamily.CONSTRAINT: StatementContract(
        StatementFamily.CONSTRAINT,
        BranchSupport.DRAFTABLE_ONLY,
        SemanticEffect.CANDIDATES,
        SemanticEffect.CANDIDATES,
    ),
    StatementFamily.TIMING: StatementContract(
        StatementFamily.TIMING,
        BranchSupport.INVALID_IN_CONTROL_BRANCH,
        SemanticEffect.NONE,
        SemanticEffect.NONE,
    ),
    StatementFamily.CONTROL: StatementContract(
        StatementFamily.CONTROL,
        BranchSupport.DRAFTABLE_ONLY,
        SemanticEffect.NONE,
        SemanticEffect.EXECUTION,
    ),
    # Fallback remains a Selection modifier. It is never generic OTHERWISE.
    StatementFamily.SELECTION_FALLBACK: StatementContract(
        StatementFamily.SELECTION_FALLBACK,
        BranchSupport.INVALID_IN_CONTROL_BRANCH,
        SemanticEffect.CANDIDATES,
        SemanticEffect.CANDIDATES,
    ),
}


@dataclass(frozen=True)
class BranchCompatibility:
    support: BranchSupport
    final_effect: SemanticEffect
    reason: str | None = None

    @property
    def commit_ready(self) -> bool:
        return (
            self.support is BranchSupport.SUPPORTED_IN_CONTROL_BRANCH
            and self.final_effect is SemanticEffect.EXECUTION
        )


def classify_branch(families: Iterable[StatementFamily]) -> BranchCompatibility:
    """Validate representation-independent control-branch semantics.

    Blockly connections and future Flow ports may both consult this contract.
    Neither representation owns or persists these rules.
    """

    effect = SemanticEffect.NONE
    saw_statement = False
    for index, family in enumerate(families):
        saw_statement = True
        contract = CONTRACTS[family]
        if contract.support is BranchSupport.INVALID_IN_CONTROL_BRANCH:
            return BranchCompatibility(
                contract.support,
                effect,
                f"{family.value} is not a control-branch statement",
            )
        if contract.support is BranchSupport.DRAFTABLE_ONLY:
            return BranchCompatibility(
                contract.support,
                effect,
                f"{family.value} is draftable but not executable in Predicate v1",
            )
        if contract.consumes is not SemanticEffect.NONE and contract.consumes is not effect:
            return BranchCompatibility(
                BranchSupport.DRAFTABLE_ONLY,
                effect,
                f"statement {index} requires {contract.consumes.value}, got {effect.value}",
            )
        effect = contract.produces
    if not saw_statement:
        return BranchCompatibility(
            BranchSupport.DRAFTABLE_ONLY,
            SemanticEffect.NONE,
            "branch is empty",
        )
    if effect is not SemanticEffect.EXECUTION:
        return BranchCompatibility(
            BranchSupport.DRAFTABLE_ONLY,
            effect,
            "branch does not produce an executable effect",
        )
    return BranchCompatibility(BranchSupport.SUPPORTED_IN_CONTROL_BRANCH, effect)
