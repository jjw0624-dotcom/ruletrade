# Isolated Blockly / Authoring Contract feasibility spike

This is an executable experiment, not a production Strategy representation. It uses the **current main** qualification operations. Blockly's workspace and IDs are disposable; only the backend response can change Canonical.

From the repository root:

```sh
make api
```

In a second shell:

```sh
cd spikes/representation-reuse
npm ci
npm run dev
```

Open `http://localhost:5178`. Try the prequalified Strategy's threshold field, then load the unqualified momentum Strategy and use **Add condition**. These actions call the real FastAPI `authoring/capabilities` and `authoring/apply` endpoints. A denied edit reports an error and reprojects the last accepted Canonical. The disclosure shows the current Flow read model and canonical source for inspection. Changes on this page are deliberately unsaved; the test covers Revision save/reopen.

Run the automated boundary test with `npm test`. It starts a temporary FastAPI process and SQLite database, tests add/edit/reject/remove, checks Flow projection, persists a Revision, and confirms the reverse external edit reprojects into logic. `npm run build` verifies TS and produces an isolated static page. The package is not imported by the production frontend; no generated files are committed.

The visual editor currently locks semantic block movement and uses capability-driven buttons for insertion/removal. It does not prove drag/drop placement, keyboard accessibility, smooth incremental reconciliation, or multiple sleeves. Its read model is a decision-order perspective, separate from the existing money-flow projection. See [the evaluation](../../docs/representation-ui-reuse-spike.md).
