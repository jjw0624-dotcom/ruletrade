# Composable Blocky grammar contract

## AssetSet expressions

`Group` and `Subgroup` are compatible AssetSet inputs. `Filter AssetSet`, `Top N AssetSet`, `Bottom N AssetSet`, random selection/filter, union, intersection and difference all output an anonymous `AssetSet`; none allocates capital. An AssetSet may nest in another AssetSet operation or be supplied directly to an Investment only when the subsequent weighting policy is explicit.

## Evaluation context

`Candidate close`, `Candidate return`, and `Candidate RSI` output `CandidateValue` only inside an AssetSet operation. `candidate A > B` turns this into an `AssetPredicate`. It cannot attach to a strategy-level `IF` as though it were global `Truth`. `Any`, `All`, and `N-of-M` explicitly aggregate an AssetSet + AssetPredicate into strategy-level `Truth`.

## Random contract

`Random N` selects exactly N members. `Random Filter` independently retains each member with probability P. They are distinct. Both require an explicit seed and redraw scope (`per evaluation`, `per schedule`, or `per strategy`) in the block. Deterministic execution is deliberately not claimed until reference and LEAN evidence define cutoff, stable asset identity, ordering, and restart/replay behavior.

## Capability boundary

The newly registered AssetSet primitives are Working Draft grammar. Their typed Blockly connections and serialization are tested, but they do not automatically translate into `SemanticProgramV2`, the reference evaluator, or LEAN. Existing verified Group/Choose/Investment paths remain unchanged.
