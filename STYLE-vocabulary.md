# Project vocabulary

This document governs domain terminology in source identifiers, filenames, UI text, comments, tests, and documentation. Read it before changing these surfaces. Keep the same vocabulary in implementation instructions and review reports.

## Product identity

| Context | Form |
|---|---|
| Product name | Typed Note Workflows |
| Product identifier stem | `TypedNoteWorkflows` |
| Repository and npm package | `obsidian-typed-note-workflows` |
| Obsidian plugin ID | `typed-note-workflows` |
| Product-specific CSS and DOM prefix | `tnw-` |

Product names retain their capitalization. Other UI text and headings use sentence case.

## Domain terms

| Concept | Prose | Identifier forms | Examples |
|---|---|---|---|
| A Markdown note classified through an explicit, contextual, or global note type | typed note | `TypedNote`, `typedNote`, `typedNotes`, `typed-note` | `TypedNoteCreationService`, `TypedNoteFieldsModal`, `createNewTypedNote`, `typedNoteSortDirection` |
| A classification and schema applicable to notes | note type | `NoteType`, `noteType`, `noteTypes`, `note-type` | `NoteTypeService`, `NoteTypeAssignmentOptions`, `assignNoteType`, `getAvailableNoteTypeNames` |
| A schema note defining a note type | note type definition | `NoteTypeDefinition`, `noteTypeDefinition` | `NoteTypeDefinitionFrontmatter`, `isNoteTypeDefinitionFile` |
| An Obsidian Bases catalog of typed notes | typed note catalog | `TypedNoteCatalog`, `typedNoteCatalog` | `createTypedNoteCatalog` |
| A field presented in a typed-note editor | typed note field | `TypedNoteField`, `typedNoteField` | `TypedNoteField`, `TypedNoteFieldService` |
| A schema field's value category, such as text, number, or structured metadata | field type | `fieldType` when naming that category | `getDefaultValueForFieldType`, `FieldDefinition.type` |

Use **note** for any Markdown note, including an unclassified note receiving its first note type. Use **file** where an operation applies to filesystem entries or to non-Markdown media as well. Do not label an unclassified note a typed note merely because it can be assigned a note type.

Use the full phrase **note type** in command names, control labels, and domain-specific class and function names. Within an explanation already discussing note types, **type** may refer back to that concept when unambiguous. Within `NoteTypeService` or another explicitly named note-type class, short methods such as `rename` and ordinary local names remain valid.

Do not use object, workflow object, typed object, workflow note, content type, or misspellings of those terms as alternate names for a typed note or note type. Do not use `TypedNoteType` for a note type. A type of typed note is a `NoteType`.

## Technical terms and stable data

The domain vocabulary does not rename language constructs, schema formats, integrations, or user data:

- JavaScript `Object`, object values, `Object.*` operations, and `typeof value === "object"` retain their meanings.
- Schema field types `Object` and `ObjectList`, and their normalized `object`/`objectlist` forms, describe structured metadata. Preserve them and their validation messages. They do not mean typed notes.
- Schema property `type` describes a field type. Integration keys such as `fileClass`, `fileClassAlias`, and `sourceType` retain the external format's spelling.
- Fileclass and Metadata Menu class terminology remains valid when explaining their APIs, schema files, inheritance, or bindings. Explain the corresponding project concept as a note type where useful.
- Existing serialized keys without obsolete object terminology, including `typesPath`, `typesPathFallback`, `fields.type`, `typeAssignment`, and `targetType`, remain stable. Their UI labels use note-type terminology. Do not rename these keys merely to change prose.
- The legacy `objectSortDirection` key is accepted only by settings migration and its regression fixtures. Current settings and consumers use `typedNoteSortDirection`.
- User properties, note type values, filenames, folders, templates, `content-type` placeholders, and examples such as `workflow-effort` are data. Do not rewrite them as branding.
- Third-party dependencies and upstream API identifiers retain their published names.

Old product, command, and symbol names may appear in explicit migration instructions and historical before/after inventories. They must not remain as current product branding or domain aliases.

## Applying the vocabulary

Rename a declaration together with its file, imports, re-exports, callers, tests, and documentation references. Update DOM producers and matching CSS selectors together. Use the field-type distinction when reviewing search results; a blanket replacement of `Object` or `type` is invalid.

Settings normalization belongs in `TypedNoteWorkflowsPlugin.loadSettings`; navigation and the settings tab consume the normalized settings. Do not add separate legacy-key fallbacks to those consumers. The settings migration tests must preserve old preferences through load, save, reload, and navigation.

Vocabulary changes must preserve schema interpretation, note contents, field values, creation, assignment, navigation, and relocation behavior. Run the affected behavioral tests and production build. Document any change to serialized settings or command IDs in [the migration guide](MIGRATION.md).
