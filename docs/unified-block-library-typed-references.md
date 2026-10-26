# Unified Block Library and Typed Reference Audit

## Root causes

1. `projectProgramBlocky()` projected every canonical Group definition as a
   `role: group` execution-canvas node. `programBlockyVisibleNodes()` removed
   only Portfolio context, so creating a reusable Group appeared to create the
   synthetic `Group · Group 1 · Choose assets` block. Group creation itself did
   not insert a Working Draft block.
2. `entryBlocklyCategoryContents()` expanded each Group/Subgroup object into a
   separate toolbox block. That mixed language primitives with object
   instances, made the flyout grow with the object library, and prevented a
   single predictable reference affordance.
3. The semantic Builder left rail was still wrapped in a collapsible control,
   so its width and canvas origin were user-variable even though the production
   contract requires a stable construction surface.
4. A Group draft was treated as Inspector content. Creating an object therefore
   opened both the dedicated Group Workspace and the Inspector rail.

## Ownership after closure

| Concern | Authority |
| --- | --- |
| Group/Subgroup definitions and identity | Object Library / canonical definitions |
| Explicit use of an object in logic | Working Draft typed reference block |
| Display name | Resolved from stable object id; never semantic identity |
| Block geometry and connection validation | Native Blockly connections |
| Capital routing | Flow projection of committed semantics |
| Canvas position, disconnected fragments, viewport | Working Draft v3 |

Asset, Group, and Subgroup references remain distinct output types. AssetSet
inputs accept Group, Subgroup, or anonymous AssetSet outputs. Numeric/Value
inputs do not accept any of these types; aggregate operations such as Count
form the explicit bridge from AssetSet to Number. Invalid legacy drafts remain
serialized and diagnosable rather than being silently reinterpreted.

The Add library now exposes one generic reference primitive per reference type.
Existing object rows can explicitly insert a reference carrying the stable id.
Creating or editing a definition never inserts a block automatically.
