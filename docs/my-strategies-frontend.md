# My Strategies frontend vertical slice

This frontend consumes the Strategy and immutable Revision API introduced by PR #22. It does not
add persistence semantics of its own.

## State ownership

- Strategy identity and base Revision are backend resources.
- Guided and Flow edit one mutable Canonical working copy initialized from the base Revision.
- Dirty state compares that Canonical snapshot with the base snapshot. Editor layout, active view,
  backtest form values, execution state, and results are excluded.
- Save sends the base Revision ID as `expected_parent_revision_id`. A successful response becomes
  the new base. An identical-source `created=false` response is also a success.
- A stale conflict preserves the working copy. Reloading latest is explicit and confirms that local
  edits will be replaced.

## Manual acceptance

1. Start the backend and frontend, then open `/explore`.
2. Choose **Use this strategy** on Growth + Defensive, confirm a name, and create it.
3. Open **My Strategies** and verify the new item is present.
4. Open it, change a Guided parameter, switch to Flow, and verify the same Canonical value.
5. Verify **Unsaved changes**, save, and verify **Saved**.
6. Navigate to Explore, return to My Strategies, and reopen it.
7. Verify the saved value, refresh the route, and verify it loads again from the backend.
8. Rename it and verify no Revision is created.
9. Run the existing real Backtest using the current working Canonical source.
10. Archive it and verify it disappears from the active list.

To reproduce a stale conflict, open the same Strategy in two tabs, edit both, save tab A, then save
tab B. Tab B must retain its edits and show **Reload latest**; it must not retry automatically.

## Intentional limits

Unsaved edits are memory-only and may be lost after confirmed navigation or refresh. History list and
historical read-only browsing are deferred; the typed client already exposes the real list/read
operations. Persistent Backtest Runs, Decision Evidence, Candidate Change, Comparison, authentication,
autosave, merging, and restore are not represented.
