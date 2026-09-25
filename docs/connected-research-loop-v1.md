# Connected research loop v1

**Status: MVP 1 COMPLETE on this branch.** This document records the product loop assembled from existing Strategy, Run, Evidence, Candidate, Comparison, Activity, and AI-handoff contracts. It adds no second truth, identity system, or execution path.

## One connected journey

The supported loop is:

```text
Build → Save → persisted Test → Result event → persisted Decision
      → decision-time Evidence → semantic address → current representation
      → user-authored threshold hypothesis → immutable Candidate Test
      → behavioral and outcome Comparison → Return or Keep → continue
```

Result events are disposable presentation records over persisted Decision summaries. Exact `runId + decisionId` enters Evidence; `componentId + optional fieldPath` enters the Strategy workspace. Result navigation, representation switching, Activity opening, Rule → Result, and AI preview are queries or UI navigation. They do not save, execute LEAN, create Candidates, or mutate Canonical.

Commands stay explicit: authoring Apply, Save, Test, Candidate Test, Keep/adopt, and AI proposal Apply. Every Strategy mutation returns through backend authority and replaces working Canonical before all representations reproject.

## Research continuity

Research remains attached while Flow, Blocky, Rules, Guide, Code, and AI switch. It retains the persisted Run, selected Decision, selected asset, destination, and width. `View rule` focuses the same semantic address in the current representation; `View in Flow` is the explicit money-flow switch. Historical Evidence continues to name its exact Run and Revision. A surviving component can be focused with a historical warning; a removed component is never guessed or matched by label.

Activity is compact persisted-artifact recovery, not an event log. It separates saved Strategy Tests from immutable Candidate Tests and opens either existing Result without executing again. Comparison remains reachable from the active Candidate journey; a general History or comparison-list API is deferred.

## Experiment and hindsight boundaries

The only connected Result experiment in MVP 1 is a user-entered qualification-threshold change already supported by Candidate v0. RuleTrade validates the exact Evidence target, runs a separate immutable Candidate, and compares deterministic behavior plus outcome metrics. Return reopens the original persisted Result. Keep uses stale-safe backend adoption and authoritative Canonical replacement.

Decision-time Evidence is information recorded when the Strategy acted. Current persisted data does not provide a reliable per-asset future-price series, so MVP 1 does not calculate subsequent asset returns. It never labels a Decision a mistake, missed opportunity, bad purchase, or optimal action. Robustness, sensitivity, parameter sweeps, and hindsight ranking remain future MVP 2 Validation work.

AI remains optional external reasoning. Its portable context uses Canonical semantics, semantic addresses, backend capabilities, and—when open—persisted decision-time Evidence. Proposal v0 deliberately accepts exactly one semantic operation. Preview asks the backend to validate without changing the working Strategy; Apply is separate and explicit. Editor serialization and presentation state are never exported as Strategy truth.

## Formative observer guide

Use one simple task and observe behavior rather than asking whether the user likes individual screens:

1. Ask the participant to build or open a Strategy, save it, and run a Test.
2. Do they notice and select a Result event without prompting?
3. Do they ask why, inspect the decision-time facts, and follow `View rule`?
4. Can they recognize the same semantic object after switching representation?
5. Do they form their own hypothesis and understand that Candidate is separate?
6. Can they explain what behavior changed in Comparison, then choose Return or Keep?
7. Do they reopen prior research from Activity and continue iterating?

Record where the participant pauses, backtracks, or mistakes historical Evidence for current state. Do not introduce optimization language or suggest a parameter value. A formative-ready session ends when the participant can describe: what the Strategy did, why, what they changed, and whether that change altered behavior.

## Deferred

MVP 2 includes Validation/robustness, sensitivity and environment sweeps, Forward, competitions, and first-class parameters. Also deferred are a historical Revision editor, subsequent-outcome analytics, drawdown-range navigation, generic event scoring/clustering, a full Strategy History surface, multi-operation AI transactions, arbitrary code editing, and broader Candidate change families.
