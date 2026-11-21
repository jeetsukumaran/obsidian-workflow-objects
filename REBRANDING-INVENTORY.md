# Typed Note Workflows migration inventory

Status: implemented in the working tree. Reviewed against baseline commit
`f4eb242ee72b75bed3e951014a1ee0f37b727383`. This report records the final migration,
including the formal `TypedNote` / `NoteType` distinction.

## Scope and result

All **64 baseline tracked files** were reviewed, including hidden repository
configuration, source, tests, documentation, package metadata, and release scripts.
**51 files changed**, including **20 file renames**; **13 files need no
content changes**. Three implementation/support files were added: the vocabulary,
installation migration guide, and settings migration tests. This report and its
CSV companion are additional audit artifacts.

- [Project vocabulary](STYLE-vocabulary.md) governs product and domain terminology.
- [Migration guide](MIGRATION.md) covers existing installations, settings, all
  command references, custom CSS, source imports, and rollback.
- [Before/after inventory](rebranding-inventory.csv) contains **747 records**,
  including every changed line block, file rename, added file, and unchanged-file
  review. Paths and line numbers refer to the baseline and resulting files,
  respectively. Empty line ranges mean that side has no lines. `before` and
  `after` cells may contain multiple lines. The CSV excludes these two audit
  artifacts themselves to avoid recursive inventories.

The implementation preserves note-writing, schema resolution, field interpretation,
relocation, and navigation behavior. The settings loader additionally translates
the old sorting preference to its canonical key. Plugin identity, command IDs,
CSS hooks, and internal source names change intentionally.

## Canonical identity

| Surface | Final form | Locations |
|---|---|---|
| Display name | Typed Note Workflows | `manifest.json`, README, UI notices and diagnostic prefixes |
| Product code stem | `TypedNoteWorkflows` | Main plugin, settings interface, settings tab, callers |
| npm and repository name | `obsidian-typed-note-workflows` | `package.json`, both package-lock root names, README release URL |
| Obsidian ID and installation folder | `typed-note-workflows` | `manifest.json`, installation and command migration instructions |
| Typed note symbols | `TypedNote`, `typedNote`, `typed-note` | Creation, editing, relocation, fields, pickers, tests |
| Note type symbols | `NoteType`, `noteType`, `note-type` | Schema discovery, assignment, cloning, renaming, callers and tests |
| Product CSS/DOM prefix | `tnw-` | `styles.css` and DOM producers |

The Obsidian plugin ID omits the `obsidian-` repository prefix to comply with
[Obsidian's manifest rules](https://docs.obsidian.md/Reference/Manifest).

## Compatibility boundaries

`objectSortDirection` is read only by settings migration. A valid
`typedNoteSortDirection` takes precedence; otherwise a valid old value is retained;
otherwise the default is `desc`. Loading does not write settings. The next save
writes only the new key. Migration tests cover preservation of other preferences,
normalization, save/reload idempotence, and navigation using the migrated value.

Changing the manifest ID changes all **23 command prefixes**. Eight command
suffixes change as well. The migration guide lists all 23 pairs; its table was
checked against the commands registered by the plugin in the test host. No old
command or source-symbol aliases remain. The renamed installation must receive
its previous `data.json` explicitly; there is no automatic old-folder import.

All **27 affected CSS/DOM tokens** were checked against their original producers
and selectors. Four `wfo-` hooks also expand `type` to `note-type`; the migration
guide lists those exact exceptions as well as the general prefix change. Other
existing generic layout classes remain unchanged.

## Renamed files

| Before | After |
|---|---|
| `src/commands/AssignObjectTypeCommand.ts` | `src/commands/AssignNoteTypeCommand.ts` |
| `src/commands/BulkAssignTypeCommand.ts` | `src/commands/BulkAssignNoteTypeCommand.ts` |
| `src/commands/CloneObjectTypeCommand.ts` | `src/commands/CloneNoteTypeCommand.ts` |
| `src/commands/CreateWorkflowObjectCommand.ts` | `src/commands/CreateTypedNoteCommand.ts` |
| `src/commands/RenameTypeCommand.ts` | `src/commands/RenameNoteTypeCommand.ts` |
| `src/modals/AssignObjectTypeModal.ts` | `src/modals/AssignNoteTypeModal.ts` |
| `src/modals/BulkAssignTypeModal.ts` | `src/modals/BulkAssignNoteTypeModal.ts` |
| `src/modals/CloneObjectTypeModal.ts` | `src/modals/CloneNoteTypeModal.ts` |
| `src/modals/ObjectFieldsModal.ts` | `src/modals/TypedNoteFieldsModal.ts` |
| `src/modals/ObjectFilePickerModal.ts` | `src/modals/TypedNoteFilePickerModal.ts` |
| `src/modals/RenameTypeModal.ts` | `src/modals/RenameNoteTypeModal.ts` |
| `src/services/ObjectAssignmentDraft.ts` | `src/services/TypedNoteAssignmentDraft.ts` |
| `src/services/ObjectCreationService.ts` | `src/services/TypedNoteCreationService.ts` |
| `src/services/ObjectFieldService.ts` | `src/services/TypedNoteFieldService.ts` |
| `src/services/ObjectUpdateService.ts` | `src/services/TypedNoteUpdateService.ts` |
| `src/services/TypeRenameService.ts` | `src/services/NoteTypeRenameService.ts` |
| `src/services/TypeService.ts` | `src/services/NoteTypeService.ts` |
| `tests/assign-object-type.test.mjs` | `tests/assign-note-type.test.mjs` |
| `tests/create-workflow-object.test.mjs` | `tests/create-typed-note.test.mjs` |
| `tests/rename-type.test.mjs` | `tests/rename-note-type.test.mjs` |

## Source identifier migration

Declarations, imports, exports, callers, test bundles, and documentation references
were updated together. This table lists changed identifiers found by comparing the
syntax trees of otherwise structurally unchanged source files. `src/main.ts` was
reviewed separately because its settings loader gains migration logic. Its product,
service, and command names use the same mappings.

| Before | After |
|---|---|
| `AssignObjectTypeModal` | `AssignNoteTypeModal` |
| `BulkAssignTypeModal` | `BulkAssignNoteTypeModal` |
| `BulkAssignTypeOptions` | `BulkAssignNoteTypeOptions` |
| `CloneObjectTypeModal` | `CloneNoteTypeModal` |
| `CloneObjectTypeResult` | `CloneNoteTypeResult` |
| `ObjectAssignmentDraft` | `TypedNoteAssignmentDraft` |
| `ObjectCreationService` | `TypedNoteCreationService` |
| `ObjectField` | `TypedNoteField` |
| `ObjectFieldService` | `TypedNoteFieldService` |
| `ObjectFieldsModal` | `TypedNoteFieldsModal` |
| `ObjectFilePickerModal` | `TypedNoteFilePickerModal` |
| `ObjectFormDraft` | `TypedNoteFormDraft` |
| `ObjectUpdateResult` | `TypedNoteUpdateResult` |
| `ObjectUpdateService` | `TypedNoteUpdateService` |
| `PlannedObjectUpdate` | `PlannedTypedNoteUpdate` |
| `RenameTypeModal` | `RenameNoteTypeModal` |
| `TypeAssignmentOptions` | `NoteTypeAssignmentOptions` |
| `TypeDefinitionFrontmatter` | `NoteTypeDefinitionFrontmatter` |
| `TypeFieldInfo` | `NoteTypeFieldInfo` |
| `TypeRenameResult` | `NoteTypeRenameResult` |
| `TypeRenameService` | `NoteTypeRenameService` |
| `TypeService` | `NoteTypeService` |
| `WorkflowObjectsPlugin` | `TypedNoteWorkflowsPlugin` |
| `WorkflowObjectsSettingTab` | `TypedNoteWorkflowsSettingTab` |
| `WorkflowObjectsSettings` | `TypedNoteWorkflowsSettings` |
| `allTypeNames` | `allNoteTypeNames` |
| `assignObjectType` | `assignNoteType` |
| `assignType` | `assignNoteType` |
| `bulkAssignType` | `bulkAssignNoteType` |
| `cloneObjectType` | `cloneNoteType` |
| `createNewWorkflowObject` | `createNewTypedNote` |
| `createWorkflowObjectCatalog` | `createTypedNoteCatalog` |
| `currentType` | `currentNoteType` |
| `existingTypeNames` | `existingNoteTypeNames` |
| `getDefaultValueForType` | `getDefaultValueForFieldType` |
| `getFilesOfType` | `getTypedNotesOfType` |
| `getPrimaryType` | `getPrimaryNoteType` |
| `getTypeFieldDefinitions` | `getNoteTypeFieldDefinitions` |
| `getTypeFieldInfo` | `getNoteTypeFieldInfo` |
| `getTypeFieldName` | `getNoteTypeFieldName` |
| `getTypeFile` | `getNoteTypeFile` |
| `getTypeFrontmatter` | `getNoteTypeFrontmatter` |
| `getTypeNames` | `getAvailableNoteTypeNames` |
| `getTypesPath` | `getNoteTypesPath` |
| `isTypeDefinitionFile` | `isNoteTypeDefinitionFile` |
| `objectSortDirection` | `typedNoteSortDirection` |
| `objects` | `typedNoteUpdates` |
| `openWorkflowObject` | `openTypedNote` |
| `prepareTypeAssignment` | `prepareNoteTypeAssignment` |
| `rememberedType` | `rememberedNoteType` |
| `renameType` | `renameNoteType` |
| `reshelveWorkflowObject` | `reshelveTypedNote` |
| `resolveTypeInfo` | `resolveNoteTypeInfo` |
| `resolvedTypeField` | `resolvedNoteTypeField` |
| `selectedType` | `selectedNoteType` |
| `typeExists` | `noteTypeExists` |
| `typeField` | `noteTypeField` |
| `typeFieldDesc` | `noteTypeFieldDesc` |
| `typeFieldName` | `noteTypeFieldName` |
| `typeFiles` | `noteTypeFiles` |
| `typeInfo` | `noteTypeInfo` |
| `typeName` | `noteTypeName` |
| `typeNames` | `noteTypeNames` |
| `typeService` | `noteTypeService` |
| `typeSuggester` | `noteTypeSuggester` |
| `typeValue` | `noteTypeValue` |
| `types` | `noteTypes` |

## File coverage

The CSV provides the exact before/after text for every changed file. In this
coverage table, renamed files are shown under their resulting paths; the rename
table above records their original locations.

| Resulting path | Review result |
|---|---|
| `.github/workflows/release.yml` | reviewed; unchanged |
| `.gitignore` | reviewed; unchanged |
| `LICENSE` | reviewed; unchanged |
| `README.md` | edited |
| `esbuild.config.mjs` | reviewed; unchanged |
| `eslint.config.js` | reviewed; unchanged |
| `manifest.json` | edited |
| `package-lock.json` | edited |
| `package.json` | edited |
| `release.txt` | reviewed; unchanged |
| `src/SettingsTab.ts` | edited |
| `src/commands/AssignNoteTypeCommand.ts` | renamed + edited |
| `src/commands/BulkAssignNoteTypeCommand.ts` | renamed + edited |
| `src/commands/CleanupCommand.ts` | edited |
| `src/commands/CloneNoteTypeCommand.ts` | renamed + edited |
| `src/commands/CopyFieldsFromCommand.ts` | edited |
| `src/commands/CreateCatalogCommand.ts` | edited |
| `src/commands/CreateTypedNoteCommand.ts` | renamed + edited |
| `src/commands/InsertMissingFrontmatterCommand.ts` | edited |
| `src/commands/NavigateCommand.ts` | edited |
| `src/commands/RenameNoteTypeCommand.ts` | renamed + edited |
| `src/commands/ReshelveCommand.ts` | edited |
| `src/commands/VaultCurationCommand.ts` | edited |
| `src/commands/WorkspaceCommand.ts` | reviewed; unchanged |
| `src/commands/index.ts` | edited |
| `src/main.ts` | edited |
| `src/modals/AssignNoteTypeModal.ts` | renamed + edited |
| `src/modals/BulkAssignPreviewModal.ts` | edited |
| `src/modals/BulkAssignNoteTypeModal.ts` | renamed + edited |
| `src/modals/CloneNoteTypeModal.ts` | renamed + edited |
| `src/modals/ConfirmModal.ts` | edited |
| `src/modals/CopyFieldsFromModal.ts` | edited |
| `src/modals/InputModal.ts` | reviewed; unchanged |
| `src/modals/TypedNoteFieldsModal.ts` | renamed + edited |
| `src/modals/TypedNoteFilePickerModal.ts` | renamed + edited |
| `src/modals/RenameNoteTypeModal.ts` | renamed + edited |
| `src/modals/SuggesterModal.ts` | reviewed; unchanged |
| `src/modals/VaultCurationModal.ts` | edited |
| `src/modals/index.ts` | edited |
| `src/schema/definitions.ts` | edited |
| `src/services/FrontmatterService.ts` | edited |
| `src/services/TypedNoteAssignmentDraft.ts` | renamed + edited |
| `src/services/TypedNoteCreationService.ts` | renamed + edited |
| `src/services/TypedNoteFieldService.ts` | renamed + edited |
| `src/services/TypedNoteUpdateService.ts` | renamed + edited |
| `src/services/NoteTypeRenameService.ts` | renamed + edited |
| `src/services/NoteTypeService.ts` | renamed + edited |
| `src/services/index.ts` | edited |
| `src/types.ts` | edited |
| `src/utils/fieldUtils.ts` | reviewed; unchanged |
| `src/utils/helpers.ts` | edited |
| `src/utils/pathUtils.ts` | edited |
| `styles.css` | edited |
| `tests/assign-note-type.test.mjs` | renamed + edited |
| `tests/assignment-editor.test.mjs` | edited |
| `tests/create-typed-note.test.mjs` | renamed + edited |
| `tests/helpers/assignment-host.mjs` | edited |
| `tests/insert-missing-frontmatter.test.mjs` | edited |
| `tests/rename-note-type.test.mjs` | renamed + edited |
| `tests/reshelve-title.test.mjs` | edited |
| `tests/schema-integration.test.mjs` | edited |
| `tsconfig.json` | reviewed; unchanged |
| `version-bump.mjs` | reviewed; unchanged |
| `versions.json` | reviewed; unchanged |
| `MIGRATION.md` | added |
| `STYLE-vocabulary.md` | added |
| `tests/settings-migration.test.mjs` | added |

## Intentional retained terminology

These occurrences are technical meanings or stable data contracts, not obsolete
product vocabulary:

- JavaScript `Object`, object values, object prototypes, `typeof` checks, and test
  fixtures representing structured metadata retain their meaning.
- Schema field categories `Object` and `ObjectList`, their normalized forms, and
  the `tnw-create-object-item` hook still describe nested metadata values.
- Field definitions retain their `type` property. HTML input types, TypeScript
  types, Bases view types, and upstream APIs retain their published spellings.
- Fileclass and Metadata Menu class terminology remains where it describes their
  APIs, schemas, inheritance, bindings, settings, or saved views.
- Persisted keys `typesPath`, `typesPathFallback`, `fields.type`, `typeAssignment`,
  and `targetType` are unchanged. UI descriptions and internal note-type methods
  use the canonical terminology.
- User-facing data examples, default folders, templates, and schema names remain
  intact, including `content-type`, `system/schema/content-types`, and
  `workflow-effort`. These are not current product aliases.
- The old sorting key remains in the migration reader and regression fixtures.
  Old product/symbol/command names remain in explicit historical migration tables.
- Generic Markdown notes may be unclassified; note type assignment therefore
  operates on “notes.” “Typed note” describes a classified note. Files remain
  “files” when a path operation or picker also concerns other media.

No remaining old product branding, domain object identifiers, old CSS prefix, or
`Obnject` spelling was found in current source, tests, metadata, README, styles,
or repository automation. Searches exclude the explicit migration/history tables,
dependency files, and private settings.

## Verification

- `npm test`: all 8 test files passed, exercising creation, assignment, field
  editing, schema integrations, insertion, reshelving, note type rename, and
  settings migration.
- `node tests/settings-migration.test.mjs`: all 10 migration/navigation cases passed.
- `npm run build`: TypeScript checking and production bundling passed.
- Syntax-tree comparison of all 42 TypeScript source files found structural changes
  only in `src/main.ts`, where settings migration was added. Other source changes
  are identifiers, literals, import paths, and comments. This structural check
  supplements behavior tests; it does not establish semantic equivalence by itself.
- Manifest/package/lockfile identities, all 23 registered commands, the migration
  table, and all 27 CSS/DOM token mappings were checked for consistency.

The test host stubs Obsidian and does not verify actual Command Palette namespacing,
live hotkeys, plugin-folder discovery, or visual rendering. Those checks require an
installed Obsidian build. No release-readiness claim is made for those surfaces.

## Generated, local, and external surfaces

| Surface | Disposition |
|---|---|
| Ignored `main.js` | Rebuilt from renamed source with the production build. |
| Ignored `data.json` | Private local settings left intact; the loader migrates the old sorting preference when those settings are supplied to the renamed installation. |
| `node_modules/` and its hidden lockfile | Dependency/cache material; not hand-edited. Package root names in the tracked lockfile are updated. |
| Git history and old release artifacts | Historical records retain the old identity. |
| GitHub repository name, description, topics, and URLs | Source URL uses the new repository name; remote repository metadata was not changed. Rename/update before publishing that link. |
| Local Git remote and checkout directory | Still use the old repository path/name. Rename/update during repository transition, outside the source migration. |
| Obsidian community listing and installation managers | Update repository/plugin identity as part of release distribution. Listing availability under the new name was not verified. |
| Existing vault plugin folders, enablement, hotkeys, macros, CSS snippets | Manual migration described in `MIGRATION.md`; no live vault configuration was edited. |

Version remains `1.2.3`; this work does not create a release, tag, commit, or remote
repository rename. Release packaging still consists of `main.js`, `manifest.json`,
and `styles.css`.
