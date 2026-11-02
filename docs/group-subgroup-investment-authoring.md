# Group, Subgroup, and Investment authoring

RuleTrade's product vocabulary now preserves three independent meanings instead of using “Investment” for all of them.

| Product object | Canonical authority | Meaning |
|---|---|---|
| Group | `GroupDefinition` → `AssetSetDefinitionV2` | Reusable candidate membership; no capital exposure |
| Subgroup | `SelectionStatementV2.output_id` | Dynamic membership produced by Choose |
| Investment | `AllocationStatementV2` and its target leg | A capital connection to an Asset, Group, or selected Subgroup |

This is a mapping onto the existing `SemanticProgramV2` model, not a competing domain model. Canonical remains authoritative after commit. Incomplete authoring order, canvas layout, and tentative connections remain in `ProgramWorkingDraft`.

## Mutation contracts

- `add_program_group`, `rename_program_group`, and `remove_program_group` own reusable membership.
- `create_program_choose` owns ranking, qualification, shortage behavior, and the named Subgroup output. It never adds Allocation.
- `remove_program_choose` removes that Choose/Subgroup meaning only when no Investment targets its output; otherwise it returns the typed `subgroup_in_use_by_investment` dependency error.
- `rename_program_subgroup` rewrites dependent Allocation references atomically.
- `set_program_investment` owns the capital target and within-target allocation method. It never changes Group membership or Choose ranking.
- `remove_program_investment_allocation` disconnects capital while preserving Group and Subgroup meaning.

The historical `add_program_investment` and `create_program_selection` contracts remain for compatibility fixtures and existing persisted workflows. New Builder tools use the separated contracts.

## Dependency behavior

Group deletion is rejected with a typed error while a Choose operation or Investment still references it. Subgroup deletion is likewise rejected while an Investment references it. A selected Subgroup may be renamed because all typed Selection targets are rewritten in the same canonical transaction. An Investment can be disconnected without deleting its selected Subgroup, after which that Subgroup can be deleted explicitly.

## Projection rules

- Structure shows Groups and their Assets/Subgroups independently from Portfolio Investments.
- Blocky shows Group, Choose/Subgroup, and Investment as distinct block roles.
- Flow is capital-only: Group or Choose alone does not fabricate a route. A route appears only after an Investment exists.
- Rules describe membership and capital operations separately.

## Authoring order

Group-first is the direct path. Asset-first opens the same Group draft. Logic-first and Investment-first are retained as recoverable incomplete drafts; the user can define the missing Group and resume the original draft without placing partial meaning in Canonical. All committed paths converge on the same existing `SemanticProgramV2` structures above.
