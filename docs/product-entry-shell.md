# Product entry and starting experience

> **Status: SUPERSEDED.** This records an earlier entry shell and Preview
> grammar. Current entry opens an ordinary persisted Strategy in the shared
> Builder; see [the living architecture](architecture.md).

RuleTrade now has three user-facing spaces around the existing research loop:

- `/` is a short public, question-led entry using supported backend examples.
- `/home` resumes persisted Strategies using their name, updated time, and current Revision.
- `/strategies/{id}` remains the single Strategy Workspace, with Summary, Guide, Flow, and its Research layer.

`/explore` is the broader catalog. `/strategy/{example}` is a preview of backend Canonical
semantics, not another Strategy type. The creation picker loads the selected backend bootstrap,
then sends that complete Canonical value through the existing Strategy creation API. After that,
examples and structures are ordinary persisted Strategies.

## Starting points

Full examples reuse `fallback`, `sleeves`, and `cooldown` and initially open Summary. Structural
starts reuse `filter` and `golden`; `one_investment` is the only new Canonical fixture. It is a
valid monthly QQQ allocation built entirely from existing primitives. Structures initially open
Guide. All starting points can subsequently move through Summary, Guide, and Flow.

Import is deliberately disabled and labelled **Coming later**. No login, ownership, recurring
contribution, or general structural-authoring semantics are introduced.

## State and responsibility boundary

The backend owns example Canonical values, persisted Strategy identity, immutable Revisions, and
their timestamps. The frontend owns only picker/preview state, the requested initial view after
creation, and a recent ordering derived from the existing Strategy list. There is no recent-work
resource and no template state is persisted into Strategy semantics.

## Acceptance

Automated coverage verifies Public routing and questions, semantic preview facts, loaded/empty/error
Home states, recent Strategy identity, picker contents, disabled Import, initial representation,
and existing Strategy/Run/Comparison deep links. Interactive browser acceptance must still be run
in an environment that permits the browser to reach the local preview server.
