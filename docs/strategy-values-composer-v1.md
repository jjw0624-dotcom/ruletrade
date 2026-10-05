# Strategy Values & Composer v1

This slice replaces the fixed trailing-return editing form with one typed Value vocabulary shared by Predicate, Eligibility, and Selection ranking.

## Executable matrix

| Value | Canonical | Dataset evaluator | Strategy compiler / LEAN | Authoring |
|---|---:|---:|---:|---:|
| Current adjusted price | Yes | Yes | Yes | Yes |
| Trailing return over completed observations | Yes | Yes | Yes | Yes |
| Rolling adjusted-price mean / median / min / max | Yes | Yes | Yes | Yes |
| Numeric constant | Yes | Yes | Yes | Condition operand |
| Value multiplied by a decimal constant | Yes | Yes | Yes | Yes |
| Current or rolling volume | Yes | No | No | Hidden as unavailable |
| RSI | Deferred | No | No | Hidden |
| Volatility | Deferred | No | No | Hidden |
| Group-derived series | No implicit series | No | No | Hidden |

`Asset` is an explicit symbol in Predicate. `Candidate` is a role bound only while Eligibility or ranking evaluates one member of the Selection universe. Universe membership remains separate from Value and comes from a stable Canonical Universe definition where one exists.

## Time and data contract

- Strategy execution uses adjusted daily price observations completed at the evaluation time.
- A current price is the last completed adjusted close available to the event.
- A rolling aggregate uses exactly the requested completed observations and never reads a future row.
- Trailing return uses `lookback + 1` completed closes.
- Missing history produces no scalar and therefore a failed ordered comparison; it is not replaced with zero.
- The maintained CSV provider is price-only. Volume is typed for forward compatibility but is never fabricated.

The compiler lowers Values into typed IR and then LEAN values. The generated C# evaluates Candidate Eligibility before ranking, records exact Canonical operand definitions and observed values in `value_condition` Evidence, and keeps Predicate control flow ahead of portfolio mutation.

## Composer and projections

The Inspector progressively reveals Subject, Value, window/aggregate, operator, constant, and optional scale. Conditions support an `ALL` conjunction of at most five ordered comparisons. `ANY`, nested boolean trees, and Strategy execution of research-only measures remain deferred.

Blocky stays a compact semantic topology: Selection shows From/Where/Order/Take as one statement, with exact Value configuration in the Inspector. Rules and Flow project the same Canonical definitions without maintaining another strategy model.

The workspace retains Blockly's native trashcan, context-menu deletion, and Delete/Backspace behavior. A second independent left-edge drag target was not added because it would duplicate Blockly drag ownership and create a brittle input path; this is a deliberate closure choice, not a missing delete capability.

## Executable proof

`strategy_values_composer_strategy()` is a maintained Canonical fixture. `scripts/generate_strategy_values_lean.py` generates its C#, and `scripts/check_lean.sh` compiles that source against the pinned LEAN image. It proves:

- Candidate current adjusted price ≥ $5 Eligibility;
- Candidate 20-observation rolling mean adjusted-price ranking;
- typed Value lowering and semantic Evidence generation.

Backend tests also cover explicit-Asset current-price Predicate control flow, atomic rejection of Volume authoring, point-in-time evaluator behavior, and Evidence parsing. Frontend tests cover the shared Value/Condition Composer vocabulary.

## Intentional debt

RSI and volatility need explicit numerical conventions and evaluator/LEAN equivalence tests before they can be exposed. Volume needs a maintained point-in-time provider. Generic arithmetic beyond multiplication by a constant, `ANY`, nested conditions, Flow authoring, and implicit group series remain outside v1.


## Semantic expression authoring UX

A complete financial Value is the user-facing editing unit. Canonical expression nodes remain typed and compositional, but the Inspector first presents compact summaries such as `SPY's 126-observation return`, `Candidate's current adjusted price`, and `0%`. Clicking a Value expands only the subject, measure, window, aggregate, or explicitly requested transform that applies to that Value. Identity scaling is never shown; multiplication appears only after **Add transform**.

Conditions are compact comparison rows:

```text
ALL of these
[ complete Value ] [ operator ] [ complete Value ]
```

Predicate and Eligibility reuse the same Condition Composer. Eligibility permits the current Candidate subject; Predicate does not. The composer continues to expose only backend-reported executable capabilities. RSI, Volume, volatility, ANY, and nested boolean authoring remain unavailable until their execution contracts exist.

### Automatic authoritative updates

Committed semantic objects have no Apply or Update button. Dropdown changes submit immediately; text and numeric fields keep a local working value and submit on blur or Enter. An operation is sent only when the complete semantic object is valid and unambiguous. The backend validates the operation and returns replacement Canonical, which is then reprojected into Blocky, Rules, Flow, and the Inspector.

The authoring controller distinguishes:

- **Saved** — no unresolved local semantic edit;
- **Updating…** — an authoritative request is in flight;
- **Unfinished** — a local Value or Condition is incomplete;
- **Invalid** — the backend rejected the edit while the last committed Canonical remains unchanged.

Only the newest request may replace Canonical, so a late response from an older edit cannot overwrite newer intent. Save and Test remain gated while a semantic edit is unfinished, updating, or invalid. An incomplete edit never appears in Rules or Flow because those views continue to project committed Canonical only.

### Control and Selection

A new IF still starts as `IF [set condition]` in LogicDraft. Completing the shared Condition Composer updates the working Control; once its branch topology is commit-ready, the Control is applied automatically. Existing committed IF conditions use the same auto-authoring path.

Selection remains one semantic surface: FROM owns Universe identity and explicit membership, WHERE opens the shared Condition Composer, ORDER BY opens the shared Value Composer, and DIRECTION, TAKE, shortage policy, and Selection fallback remain distinct. Compact Blocky labels deliberately defer exact details to this Inspector.

The components are representation-independent. Future Flow route editing can reuse Condition Composer, and a future Asset Workspace can reuse the collapsed Value row and progressive Value editor without introducing a second expression grammar. Neither future product is implemented here.

### Delete and undo boundary

Blockly remains the sole owner of structural drag, delete, and undo/redo. Native trash, Delete/Backspace, context-menu deletion, movement, detach, and reconnect are preserved. A second left-edge drag engine is intentionally not added because it would compete with Blockly ownership. Semantic field edits are backend-authoritative Canonical replacements and are not inserted into Blockly's structural undo stack; reprojection therefore cannot resurrect stale pre-Canonical field state.
