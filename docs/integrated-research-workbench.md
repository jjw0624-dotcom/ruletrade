# Integrated Strategy research workbench

> **Status: CURRENT frontend contract.** System-wide ownership is summarized in
> [the living architecture](architecture.md).

The Strategy Builder remains mounted while saved research opens in the resizable right workspace.
Summary, Guide, and Flow remain representations of one working Canonical Strategy; Test, Result,
Decision analysis, Candidate, Comparison, and adoption are research states attached to that Strategy.

The right edge has two separate responsibilities. **Activity** is a compact overlay for discovering
persisted revisions and Runs. **Research** is the large, resizable destination for the active Result,
Decision, Candidate, or Comparison. Opening Activity never replaces the active Research destination;
choosing a Run in Activity switches Research to that Run. Closing Research preserves its destination
so the dedicated rail action can reopen it.

## State ownership

| State | Owner | Does it dirty Canonical? |
| --- | --- | --- |
| Working Canonical, Registry, Strategy/Revision identity | existing Strategy editor | Semantic edits only |
| Representation, semantic selection, left panel, xyflow viewport/positions | Builder UI | No |
| Activity open/closed, Research open/closed and Research width | workbench research reducer | No |
| Active Run, session, asset, Candidate/Comparison destination | workbench research reducer and existing research components | No |
| Candidate Canonical | existing immutable Candidate backend record | No |
| Adopted Candidate | existing adoption endpoint and new immutable Revision | Yes, only after Keep succeeds |

The right-side state stores identifiers and the existing `ResearchContext`; it is not a second Result,
Evidence, Candidate, Comparison, or Strategy model.

## Integrated progression

1. **Activity** lists Runs already persisted for the Strategy's Revisions without becoming a Research state.
2. **Test** uses the existing setup, market-data preflight, and BacktestRun endpoint. The returned Run
   opens in the right workspace without changing the Strategy route.
3. **Result and Decision analysis** reuse the existing normalized Result and persisted Decision Evidence.
4. **View rule** selects exact `component_id` plus optional `field_path` in the shared Inspector.
   **View in Flow** also switches the representation and focuses the matching xyflow node.
5. **Show where this mattered** reuses existing Evidence GET requests and opens the selected persisted
   Run/session/asset in the same right workspace. It never creates or reruns a Backtest.
6. **Try change**, Candidate execution, Comparison, and Keep/Return reuse their existing immutable APIs.
   Successful Keep replaces the working Canonical with the adopted Revision response and leaves Test
   immediately available.

Research defaults to 60% of the workbench and can resize between 45% and 85%. Comparison opens at
least 72% because its behavior and result diffs need more horizontal room; a wider user-selected
size is preserved. While Research is open, it
supersedes the Inspector column without clearing semantic selection; closing Research restores the
Inspector for the still-selected component.

Result, Decision, Candidate, and Comparison layouts respond to the Research panel's own width rather
than only the browser viewport. Narrower user-selected widths stack dense two-column investigation
surfaces instead of forcing or clipping a desktop layout.

## Explore entry

Public, Explore, Home, and the Creation Picker now send a selected example into the ordinary Strategy
creation confirmation. The duplicate example Preview is no longer in the primary path. Creation is
event-driven and guarded while a request is in flight, so rendering and browser history do not create
Strategies. An old `/strategy/{example}` link shows only a compatibility handoff into the same ordinary
creation flow.

## Reuse classification

- `REUSE EXISTING`: Canonical editor, immutable Revisions, market-data preflight, BacktestRun, Decision
  Evidence, ResearchContext, Candidate, Comparison, and adoption.
- `ADOPT EXTERNAL`: `react-resizable-panels` owns split sizing; Radix Tooltip owns the collapsed-rail
  tooltip; xyflow continues to own Flow viewport/focus mechanics.
- `SMALL NEW SEMANTIC`: none. The workbench reducer is UI orchestration only.
- `DEFER`: comparison listing (no list API), chart-engine migration, future Builder representations,
  expanded authoring semantics, Replay, optimization, and analytics infrastructure.

## WSL browser acceptance

After `make bootstrap`, start the existing services with a configured
LEAN-format data directory:

```bash
cd ~/dev/ruletrade
export RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data"
make api
```

In a second WSL shell:

```bash
cd ~/dev/ruletrade
make frontend
```

Then exercise the final journey in the browser using a Strategy and period supported by the local data.
Real Docker/LEAN and persisted Evidence are required for the runtime acceptance; frontend tests do not
substitute for it.
