# Product surface contract

RuleTrade combines a Figma-like strategy workspace with a Baekjoon-like problem
and submission loop. These are connected product surfaces, not one oversized
Builder.

## Core rule

A strategy's shared meaning is stored as Canonical V2 and saved as an immutable
Revision. Builder perspectives, research tools, and problem submissions consume
that same meaning, but each surface owns a different job.

Evaluation policy, experiment configuration, and submission state are not part
of Builder meaning.

## Surface ownership

| Surface | Route | Owns | Must not own |
| --- | --- | --- | --- |
| Strategy repository | `/strategies` | Saved strategies as durable design objects | Editing canvas or experiment configuration |
| Strategy object | `/strategies/:id` | Current Revision, version context, entry to Builder and Research | Builder-local drafts |
| Builder | `/strategies/:id/builder` | Guide, Flow, Blocky, Rules, Code, AI perspectives; assets; undo/redo; Save; quick feedback named **Test** | Detail BT, Hidden BT, robustness Tests, Forward, competition submission |
| Research | `/strategies/:id/research` | Detail BT, Hidden BT, robustness/random Tests, Forward, saved experiment history and comparison | Strategy-authoring controls |
| Learning index | `/learning` | Discover learning problems and progress | Problem execution or Builder state |
| Learning problem | `/learning/problems/:problemId` | Problem statement, constraints, objective, strategy selection/build loop, immutable Revision submission, attempts and result feedback | General research dashboard |
| Competition index | `/competitions` | Discover active and prior competitions | Competition execution state |
| Competition | `/competitions/:competitionId` | Competition rules, eligibility, objective, strategy selection/build loop, immutable Revision submission, ranking/leaderboard | General Builder navigation |

## Builder

Builder is the equivalent of a Figma canvas or a Baekjoon code editor. It is the
place to create and change a strategy.

Its execution button is **Test**. Test is a quick backtest intended for short,
frequent feedback while editing. It may trade precision or configurability for
speed. Saving produces a normal Strategy Revision that can be used elsewhere.

Builder must remain independently evolvable. Advanced evaluation tools are
linked through the saved Strategy object instead of being embedded into Builder
chrome or Builder state.

## Strategy repository and Research

The strategy repository is analogous to Figma's design list. A saved strategy is
a durable object, not merely a Builder session.

Opening a strategy shows its current Revision and offers two explicit paths:

- **Edit in Builder** changes the strategy and can save a new Revision.
- **Research** evaluates a selected immutable Revision.

Research owns the shared backtest foundation for:

- **Detail BT**: the normal high-fidelity backtest, including slower and more
  realistic controls such as exchange-rate and timing detail.
- **Hidden BT**: holdout evaluation and parameter search where hidden evaluation
  data reduces overfitting risk.
- **Tests**: robustness, timing, asset, and random-baseline experiments that
  separate luck and implementation sensitivity.
- **Forward**: a persistent paper-forward view of what would have happened after
  a chosen start point.

Experiment results must preserve the exact Revision, configuration, data
identity, engine identity, and evidence needed for reproduction and comparison.

## Learning and Competitions

Learning and Competitions are Baekjoon-like, problem-first surfaces.

The loop is:

1. Read a problem or competition policy.
2. Create a constrained strategy or select an eligible saved strategy.
3. Enter Builder when editing is needed.
4. Return to the problem page.
5. Submit one exact immutable Revision.
6. Review the result and iterate between feedback, the strategy object, Research,
   and Builder.

A problem may restrict assets, require an option, limit trade count, force a
random action, or define another executable policy. Those restrictions belong to
the problem/submission contract. Builder may display and enforce the active
policy while editing, but the policy does not become a general Builder feature.
The Builder URL preserves the originating challenge ID and kind so refreshes,
shared links, and browser navigation retain the return path without making the
challenge part of the Strategy meaning.

Learning prioritizes guided objectives, attempts, and explanation. Competitions
prioritize rule compliance, scoring, and ranking. They may share submission
infrastructure without sharing the same page.

## Shared execution foundation

All durable evaluation paths use the same lineage:

`Canonical V2 -> immutable Revision -> LEAN execution -> Run -> Evidence`

Quick Test may use a deliberately faster execution profile, but it must identify
that profile honestly. Detail BT, Hidden BT, Tests, Forward, Learning, and
Competitions add policies and orchestration around the shared durable backtest
foundation rather than creating unrelated strategy meanings.

## Navigation acceptance

The product is correctly separated only when all of these remain true:

- Builder exposes Save and Test, but no Detail BT, Hidden BT, Tests, Forward, or
  submission controls.
- A saved Strategy object links separately to Builder and Research.
- Research tools open from the Strategy/Research surface and keep experiment
  history outside Builder drafts.
- Learning and Competitions have independent problem-list and submission pages.
- A problem-driven editing round trip returns to the originating problem page
  with the exact saved Revision available for submission.
