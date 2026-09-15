# Integrated Strategy research workbench

The Strategy Builder remains mounted while saved research opens in the resizable right workspace.
Summary, Guide, and Flow remain representations of one working Canonical Strategy; Test, Result,
Decision analysis, Candidate, Comparison, and adoption are research states attached to that Strategy.

## State ownership

| State | Owner | Does it dirty Canonical? |
| --- | --- | --- |
| Working Canonical, Registry, Strategy/Revision identity | existing Strategy editor | Semantic edits only |
| Representation, semantic selection, left panel, xyflow viewport/positions | Builder UI | No |
| Open/closed research surface and width | workbench research reducer | No |
| Active Run, session, asset, Candidate/Comparison destination | workbench research reducer and existing research components | No |
| Candidate Canonical | existing immutable Candidate backend record | No |
| Adopted Candidate | existing adoption endpoint and new immutable Revision | Yes, only after Keep succeeds |

The right-side state stores identifiers and the existing `ResearchContext`; it is not a second Result,
Evidence, Candidate, Comparison, or Strategy model.

## Integrated progression

1. **Activity** lists Runs already persisted for the Strategy's Revisions.
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

Start the existing services with a configured LEAN-format data directory:

```bash
cd ~/dev/ruletrade
export RULETRADE_LEAN_DATA_DIR="$HOME/dev/ruletrade/experiments/lean-spike/data"
uv run uvicorn ruletrade.api:app --reload
```

In a second WSL shell:

```bash
cd ~/dev/ruletrade/frontend
npm install
npm run dev
```

Then exercise the final journey in the browser using a Strategy and period supported by the local data.
Real Docker/LEAN and persisted Evidence are required for the runtime acceptance; frontend tests do not
substitute for it.
