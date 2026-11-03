# Perspective completeness audit

All perspectives consume committed `SemanticProgramV2` meaning. Blocky and Flow may preserve independent draft/layout state, but neither may become a competing committed source.

| Requirement | Summary | Rules | Flow | Code | Guide | AI |
|---|---:|---:|---:|---:|---:|---:|
| Same committed semantic identity | PASS | PASS | PASS | PASS | PASS | PASS |
| Blank/incomplete rendering without lowering | PASS | PASS | PASS | PASS | PASS | PASS |
| Full universe/group/subgroup explanation | PASS | PARTIAL | N/A by design | PASS exact semantics | PASS walkthrough | Raw handoff |
| Schedule/clock explanation | PASS | PARTIAL | Property only | PASS exact semantics | PASS walkthrough | Raw handoff |
| Condition/ranking/selection | PASS | PASS render | Only capital-affecting | PASS exact semantics | PASS walkthrough | Raw handoff |
| Allocation/fallback | PASS | PASS render | PASS | PASS exact semantics | PASS walkthrough | Raw handoff |
| Temporal/state semantics | PASS summary | PASS render | Omitted by design unless capital-affecting | PASS exact semantics | PASS walkthrough | Raw handoff |
| Capability/missing inputs | PASS | PASS guidance | Draft diagnostics only | PASS | PASS | FAIL |
| Latest Run/result link | PASS | FAIL | FAIL | PASS metadata | FAIL | FAIL |
| Safe typed editing | N/A | PARTIAL | PARTIAL | UNSUPPORTED | PARTIAL | Proposal apply only |
| Real-browser end-to-end proof | FOCUSED | FOCUSED | PARTIAL | FOCUSED | FOCUSED | NOT TESTED |

## Implemented boundary

1. Summary now projects objective, universe, timing, selection/conditions, allocation, behavior, missing inputs, capability, and the latest saved Run. Its result action opens the existing right-side detail rail.
2. Rules retains addressed declarative rows and adds product-level execution/missing-input guidance. Supported edits still use the shared Inspector and CAS.
3. Flow remains capital-only; arithmetic, memory and event internals do not become capital nodes.
4. Code remains read-only and now envelopes exact Canonical with revision ID/hash/schema, capability, and latest Run provenance/result.
5. Guide walks Groups, clocks and every committed Program statement, with semantic-address navigation and explicit next inputs.
6. AI remains an external handoff; no model service or parallel semantic authority was introduced.

The focused browser acceptance script switches through Summary, Guide, Rules, and Code, checks that their headings clear the shared tab chrome, rejects leaked lowering diagnostics, and captures each surface. It does not yet prove Decision Evidence navigation from every perspective.

Blocky is intentionally excluded from feature expansion in this program.

