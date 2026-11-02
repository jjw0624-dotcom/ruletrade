# Builder browser acceptance

## Environment result

Browser execution is not proven in the implementation workspace: no Chromium, Chrome, Playwright executable, or direct Playwright project/dependency is present at the verified dependency head. Vitest/jsdom tests are not counted as browser evidence.

## Required automated journeys

Run each journey at 1366×768, 1440×900, and 1920×1080. Capture a screenshot after each numbered assertion and retain the browser trace on failure.

1. Create ten Groups from Objects. Assert zero new Blockly blocks and ten stable Object Library entries.
2. Begin Group creation, edit name/assets, cancel. Assert Canonical hash, canvas serialization and object count are unchanged.
3. Open Assets in native Blockly Add, drag a Group reference into an Investment target, and assert typed native connection plus stable object ID.
4. Create, move, connect, disconnect and delete multiple fragments. Assert unrelated fragments persist and native undo/redo restores each gesture.
5. Open a category with a long block preview. Assert the native flyout overlays without resizing/recentering the workspace and drag remains active while the pointer crosses the flyout boundary.
6. Select a block, open/close Inspector, and assert selection, coordinates and connections remain unchanged.
7. Switch Blocky → Flow → Rules → Blocky. Assert the original Blockly DOM/workspace and draft serialization survive; Flow contains only capital nodes.
8. Save, leave and reopen. Assert Canonical meaning, disconnected fragments, positions, viewport, collapse and selection recover.
9. Resize through all supported viewports. Assert flyout remains bounded and the workspace coordinate under a stationary block does not change.
10. Create a conditional strategy. Assert Boolean/calculation pieces remain Blocky-only while Flow shows only the affected capital routes.

## Current outcome

Code-level ownership and mounted interaction regressions are implemented. Real pointer, hit-testing, flyout overlay and responsive layout outcomes remain **not run** until a browser-capable runner is added or supplied.
