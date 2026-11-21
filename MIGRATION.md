# Migrating to Typed Note Workflows

Typed Note Workflows replaces the Workflow Objects product name and uses **typed note** and **note type** throughout the interface and code. Its Obsidian ID is `typed-note-workflows`; its repository and npm package name are `obsidian-typed-note-workflows`.

The plugin ID change requires an explicit installation transition. Existing settings are not automatically imported from a differently named plugin folder. Old command IDs are not registered as aliases.

## Existing installations

1. Back up the vault's configuration directory, including the old plugin's `data.json` and any custom hotkeys or command-launcher configuration. The configuration directory is usually `.obsidian`, but a vault can use another location.
2. Disable Workflow Objects in Community plugins, then close Obsidian.
3. If `<configDir>/plugins/typed-note-workflows/` does not exist, rename `<configDir>/plugins/workflow-objects/` to that directory. Preserve `data.json`. Replace `main.js`, `manifest.json`, and `styles.css` with the new build or release artifacts. The installed directory must match the new manifest ID. [Obsidian manifest reference](https://docs.obsidian.md/Reference/Manifest).
4. If the destination directory already exists, preserve both copies of `data.json` and deliberately choose or merge the settings to retain. Do not overwrite an existing new installation's configuration without reviewing it.
5. Remap any saved command references using the table below. In `hotkeys.json`, these references are property names; preserve the associated hotkey arrays. If both old and new keys already exist, resolve that conflict explicitly. Review command bookmarks, scripts, macros, buttons, and command URIs that invoke this plugin.
6. Reopen Obsidian and enable Typed Note Workflows. Keep only the new installation enabled. Confirm schema integration, path/filename rules, assignment choices, sort direction, and custom commands before using commands that write notes.

For a fresh installation, copy the three release artifacts into `<configDir>/plugins/typed-note-workflows/` and enable Typed Note Workflows. Follow the same directory rule when loading a development build or installing through a third-party plugin manager.

The rename does not require rewriting Markdown notes, schema notes, note type values, user properties, LiquidJS templates, or existing Bases catalogs. Schema field types `Object` and `ObjectList` continue to mean structured metadata.

## Saved sorting preference

The settings loader translates `objectSortDirection` to `typedNoteSortDirection`:

1. A valid new value (`asc` or `desc`) takes precedence.
2. Otherwise, a valid legacy value supplies the preference.
3. Otherwise, the default is `desc`.

Loading does not overwrite the settings file. On the next settings save, the plugin writes `typedNoteSortDirection` and omits `objectSortDirection`. Other settings keys retain their existing formats, including `typesPath`, `fields.type`, and `typeAssignment`.

To roll back to an older plugin release, restore the backed-up installation/configuration. An older release does not understand the new sorting key or command IDs.

## Saved command references

Every command prefix changes from `workflow-objects:` to `typed-note-workflows:`. Eight local command IDs also change. Combine the prefix and the local ID from the appropriate column; for example, `workflow-objects:create-new-workflow-object` becomes `typed-note-workflows:create-new-typed-note`.

| Old local command ID | New local command ID |
|---|---|
| `create-new-workflow-object` | `create-new-typed-note` |
| `navigate-next` | `navigate-next` |
| `navigate-previous` | `navigate-previous` |
| `open-workflow-object` | `open-typed-note` |
| `sort-frontmatter` | `sort-frontmatter` |
| `sort-frontmatter-schema` | `sort-frontmatter-schema` |
| `sort-frontmatter-alphabetical` | `sort-frontmatter-alphabetical` |
| `insert-missing-frontmatter-alphabetical` | `insert-missing-frontmatter-alphabetical` |
| `insert-missing-frontmatter-schema` | `insert-missing-frontmatter-schema` |
| `append-missing-frontmatter` | `append-missing-frontmatter` |
| `prepend-missing-frontmatter` | `prepend-missing-frontmatter` |
| `clean-frontmatter` | `clean-frontmatter` |
| `clean-frontmatter-standard` | `clean-frontmatter-standard` |
| `clean-frontmatter-strict` | `clean-frontmatter-strict` |
| `assign-object-to-different-type` | `assign-note-type` |
| `reshelve-workflow-object` | `reshelve-typed-note` |
| `clean-workspace` | `clean-workspace` |
| `curate-vault` | `curate-vault` |
| `create-workflow-object-catalog` | `create-typed-note-catalog` |
| `clone-object-type` | `clone-note-type` |
| `rename-type` | `rename-note-type` |
| `copy-fields-from` | `copy-fields-from` |
| `bulk-assign-type` | `bulk-assign-note-type` |

## CSS snippets

Custom snippets using plugin classes need these changes:

| Old selector prefix or class | New selector prefix or class |
|---|---|
| `wfo-create-*` | `tnw-create-*` |
| `wfo-bulk-preview-*` | `tnw-bulk-preview-*` |
| `wfo-create-type` | `tnw-create-note-type` |
| `wfo-bulk-preview-current-type` | `tnw-bulk-preview-current-note-type` |
| `wfo-hidden` | `tnw-hidden` |
| `wfo-rename-type-modal` | `tnw-rename-note-type-modal` |
| `wfo-rename-type-status` | `tnw-rename-note-type-status` |
| `workflow-objects-confirm-message` | `tnw-confirm-message` |
| `workflow-objects-code-hint` | `tnw-code-hint` |
| `clone-object-type-modal` | `clone-note-type-modal` |

The two exact class mappings override the general prefix mappings above. The folder datalist IDs also change from `wfo-bulk-folder-list` and `wfo-vault-folder-list` to the corresponding `tnw-` IDs. `tnw-create-object-item` retains `object` because it represents a structured metadata item, not a typed note.

## Source consumers

Internal typed-note types and services use the `TypedNote` stem; note-type operations use `NoteType`. Examples include `TypedNoteFieldsModal`, `TypedNoteCreationService`, `TypedNoteUpdateService`, `NoteTypeService`, and `NoteTypeRenameService`. The product class is `TypedNoteWorkflowsPlugin`.

Update imports and source integrations to the new declarations. No source-level aliases under the former names are retained. [Project vocabulary](STYLE-vocabulary.md) defines the naming rules, and [the migration inventory](REBRANDING-INVENTORY.md) records the affected files.
