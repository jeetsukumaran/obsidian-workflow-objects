# Typed Note Workflows

An Obsidian plugin for creating, navigating, and organizing typed notes.

Typed Note Workflows uses fileClass schemas to create and curate typed notes, including their filenames, locations, and frontmatter. It supports [Fileclass](https://github.com/mdelobelle/fileclass), [Metadata Menu](https://github.com/mdelobelle/metadatamenu), and standalone schema files.

---

<details>
<summary><strong>Typed notes and fields</strong></summary>

A typed note is an ordinary Markdown note classified by a *note type*.
Each note type defines a set of properties, called *fields*.
A typed note with note type `article` carries fields like `author`, `status`, and `rating`; a typed note with note type `project` carries `deadline`, `team`, and `priority`.

</details>

Use **typed note** for a classified note, **note type** for its classification,
and **field type** for a metadata value category such as text, number, or an
object. Source identifiers use `TypedNote` and `NoteType` respectively; see the
[project vocabulary](STYLE-vocabulary.md).

---

## Schema integrations

**Schema source** selects Automatic, Fileclass, Metadata Menu, or Standalone.
Automatic prefers an enabled Fileclass plugin, then Metadata Menu, then standalone
schema files. Explicit selection never silently switches to another integration.
Neither external plugin is required in standalone mode.

Typed Note Workflows reads the selected integration's class folder and note type field
alias. **Note types path** and **Note type field** override those values. Standalone mode
uses the configured folder (or **Fallback note types path**) and defaults to `fileClass`.
Class names include subfolders: `Classes/work/project.md` defines `work/project`.
Fileclass's public schema API supplies resolved fields when available and when
its folder matches the configured folder; otherwise Typed Note Workflows reads the
schema files directly.

The schema resolver includes inherited root fields, `excludes`, and both
Fileclass name-based and Metadata Menu ID-based `fieldsOrder` lists. Nested
children remain inside their parent objects; insertion never promotes them into
separate top-level properties. Fileclass insertion uses empty defaults (`{}` for
objects, `[]` for lists, and an empty string for scalar fields). Standalone and
Metadata Menu retain Typed Note Workflows' scalar defaults, including current dates,
false booleans, and null numbers.

For existing notes, metadata operations combine explicit classes with tag,
folder, and bookmark bindings. Fileclass's global class applies as a baseline;
Metadata Menu's global class applies when no other class supplies fields. The note type
property and frontmatter tags that bind classes are protected from cleanup.
Navigation and opening by note type recognize these bindings. Reshelving uses the
first explicit note type, otherwise the first contextual note type, then the global note type.

**Preset fields are not supported.** Typed Note Workflows neither reads nor inserts
Metadata Menu presets. Existing preset values remain ordinary note properties:
normal insertion preserves them, and cleanup follows the selected removal
policy. To retain shared fields as schema members, declare them in a class,
parent class, or applicable global class. Changing the schema source does not
edit another plugin's settings or migrate notes automatically.

A missing parent, malformed schema, inheritance cycle, stale Fileclass index,
or unavailable selected integration prevents schema-based deletion. Cleanup
preserves unknown fields, including empty ones, and reports the problem;
reassignment stops before writing. Metadata Menu's Dataview query bindings cannot
be evaluated for a proposed note state, so configured query bindings also prevent
removal and reassignment. Presets and Dataview inline fields are outside this
plugin's schema support.

Use one external schema manager at a time. Fileclass's author advises against
enabling Fileclass and Metadata Menu together; if both are enabled, automatic
selection consistently chooses Fileclass.

## Installation

When the renamed release is available in the community plugin directory:

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **Typed Note Workflows** and install.
3. Enable the plugin.

**Manual installation:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jeetsukumaran/obsidian-typed-note-workflows/releases/latest) and copy them to `.obsidian/plugins/typed-note-workflows/` inside your vault.

**Existing installations:** follow the [migration guide](MIGRATION.md) to retain
settings and remap saved commands when changing the plugin directory and ID.
The directory above assumes the default `.obsidian` configuration directory.

---

## Note type definitions

The plugin reads note type schemas from a folder of Markdown notes. Each definition's **filename** is its note type name — `article.md` defines the `article` note type, `project.md` defines the `project` note type, and so on. The definition's **frontmatter** carries the field schema in Metadata Menu's fileClass format:

```yaml
---
fields:
  - name: author
    type: Input
  - name: status
    type: Select
    options:
      valuesList:
        draft: ""
        published: ""
  - name: rating
    type: Number
---
```

The selected integration supplies this folder unless **Note types path** overrides it. Standalone mode reads the same file format without an external plugin.

---

## Commands

All commands are available from the Command Palette (`Ctrl/Cmd+P`).

---

### Create new typed note

Select a note type to open a form containing its fields, including inherited fields and
nested objects. The configured title field is always available and must be filled
in before creation.

- **Text:** multiline editors, including the title. Free-text lists accept commas
  or new lines and save as YAML lists.
- **Dates and times:** native date, datetime, and time pickers, initially set to the
  current local date/time. Field-specific formats take precedence over Fileclass's
  date defaults for each field type; otherwise values use ISO format. Date-link options are
  respected.
- **Numbers, booleans, and choices:** numeric inputs, toggles, and schema-defined
  choice controls. Structured JSON/YAML values remain structured metadata;
  objects and object lists with child definitions have nested forms.
- **File and media links:** searchable pickers follow Fileclass's Base view order,
  grouping, and display labels. Multi-file selections retain view order. Links
  use the vault's link preferences and the new note's final directory, without
  embedding media.

The live destination uses your **path mappings** and **filename mappings**, with
all entered metadata available to templates. Enable **Override directory** and/or
**Override filename** to choose another destination. An empty directory override
means the vault root; the filename accepts an optional `.md` extension.

Click **Create typed note** to write and open the note. Selected editor text becomes
its body. Cancel creates nothing. Validation errors, write failures, and filename
collisions keep the form open with your entries intact.

Fileclass Base filters using `this` require a saved note and cannot see this form's
draft values. The picker explains this and offers **Show all files**. It also
falls back to all Markdown/media files when Bases is unavailable or the query
fails. Formula and lookup fields are displayed as calculated fields; their
schema provider computes them after creation. Metadata Menu Dataview choice
sources require a saved note, so the form allows manual value entry instead.

---

### Navigate to next / previous typed note with matching note type

From any typed note, jumps to the next or previous note of the same note type, sorted by filename. Wraps around at the boundary unless wrap-around navigation is disabled in settings.

Use this to page through notes of a given note type, such as all your `book` notes or all your `project` notes.

---

### Open typed note by note type

Two-step picker: first choose a note type, then choose a matching typed note. The list is sorted by filename, newest-first by default when filenames carry date prefixes.

---

### Reshelve typed note

Moves and renames the active note to match its current frontmatter — applying your path and filename template settings to its note type and title fields. Use this after changing the note type or title, or after updating your path mapping rules, to bring the note into its correct location.

If the configured title field is missing, null, or blank, reshelving prompts for a title, prefilled with the current filename without its extension. Accepting saves the title to that field and uses it in the path and filename templates. Cancelling or submitting an empty value skips reshelving that note. This also applies to the reshelve operation in **Curate vault**; any earlier clean or sort operations remain applied.

Reshelving and note type assignment share title prompting, path planning, collision checks, and move recovery. A failed move leaves metadata unchanged. If saving a prompted title fails after the move, the plugin attempts to restore the original location and reports any restoration failure.

If the filename already encodes a date prefix (e.g. `20240315T0930--my-note.md`), that prefix is preserved unless the frontmatter contains a more authoritative date field (see *Date prefix source fields* in settings).

---

### Sort frontmatter

Reorders the active note's frontmatter fields using the default sort mode from settings (schema order or alphabetical). Equivalent to running *Sort frontmatter (schema order)* or *Sort frontmatter (alphabetical)* depending on your **Default field sort** setting.

---

### Sort frontmatter (schema order)

Reorders frontmatter fields to match the sequence defined in the note type schema. Fields not present in the schema are moved to the end.

---

### Sort frontmatter (alphabetical)

Reorders frontmatter fields A–Z, regardless of schema.

---

### Insert, append, or prepend missing front matter

These four commands add absent fields to the active note using the note type schema's
defaults. Existing values are preserved,
including empty strings, nulls, false, zero, lists, and fields outside the schema.
A field is missing only when its key is absent.

| Command (after the `Typed Note Workflows:` prefix) | Field order |
|---|---|
| Insert missing front matter (alphabetical) | Sorts the entire frontmatter A–Z, including existing fields. |
| Insert missing front matter (schema order) | Sorts the entire frontmatter by schema order, then places other fields alphabetically at the end. |
| Append missing front matter | Adds missing fields after the existing fields, preserving existing field order. |
| Prepend missing front matter | Adds missing fields before the existing fields, preserving existing field order. |

Append and prepend arrange the newly added fields in schema order. Schema order
accepts field names or legacy field IDs in `fieldsOrder`, including inherited root fields. These commands do not use the default sort setting.

Notes without an explicit note type can use contextual or global classes. Without an
applicable schema there are no fields to add, and schema sorting falls back to
alphabetical order. Presets never supply fields.
The two insert commands still sort when no fields are missing; append and prepend
leave the field order unchanged in that case.

### Clean frontmatter (interactive)

Opens a menu of cleanup actions for the active typed note. Each action is a predefined combination of three independent operations: adding fields missing from the schema, removing fields not present in the schema, and sorting the result.

| Action | Adds missing fields | Removes undefined fields | Sort |
|---|:---:|:---:|---|
| Sort alphabetical | — | — | A–Z |
| Sort following schema | — | — | Schema order |
| Ensure schema (default sort) | ✓ | — | From settings |
| Ensure schema (select sort…) | ✓ | — | Chosen interactively |
| Enforce schema (default sort) | ✓ | ✓ | From settings |
| Enforce schema (select sort…) | ✓ | ✓ | Chosen interactively |
| Custom… | Chosen interactively | Chosen interactively | Chosen interactively |

When an *enforce* action would delete fields that currently have values, the plugin shows a confirmation dialog listing exactly which fields and values would be lost before proceeding.

---

### Clean frontmatter (standard)

Non-interactive *ensure*: adds missing schema fields, preserves declared fields and non-empty extra fields, removes empty extra fields when the schema is complete, and uses the default sort from settings.

---

### Clean frontmatter (strict)

Non-interactive *enforce*: adds missing fields **and removes** any fields not defined in the note type schema, using the default sort from settings. Use with care — there is no confirmation dialog.

---

### Create typed note catalog

Generates an [Obsidian Bases](https://obsidian.md/bases) `.base` file that serves as a live catalog of notes of a chosen note type.

**Flow:**
1. Choose a note type from the suggester.
2. Review or edit the destination directory and filename (pre-filled from your catalog settings).
3. Click **Create**.

The generated catalog (`.base` file) includes:

- A filter that selects all notes of the chosen note type.
- A **Title** column rendered as a clickable link using each note's title field.
- One column per schema field. Fields of type `File` (links to other notes) are rendered as titled links to the target note; all other fields are shown as raw property values.
- Optional **Date created** and **Date modified** columns (controlled by settings).
- Sentence-case display names for all columns (e.g. `workflow-effort` → `Workflow effort`), unless remapping is disabled.

If a `.base` file already exists at the target path, a collision dialog offers three options: **Replace** (overwrite), **Rename** (enter a new filename), or **Cancel**.

---

### Clone note type

Creates a new note type (fileClass) as a copy of an existing one.

**Flow:**
1. Choose a source note type from the suggester.
2. A dialog opens showing the new note type's name (pre-filled as `<source>-copy`) and all fields from the source schema.
3. Edit the name — collisions with existing note type names are caught and flagged live.
4. In the field list, for each field:
   - **Uncheck** the checkbox to omit the field from the clone entirely.
   - **Edit the name input** to rename the field in the clone (leave blank to keep the source name).
   - **Drag the row** or use the **↑ / ↓ buttons** to reorder fields.
5. Click **Clone**.

The new fileClass note is created in the same folder as your other note type definitions (the Metadata Menu fileClass folder, or your configured Note types path). It is populated with only the fields you kept, under the names and in the order you specified. Each field receives a fresh unique ID so Metadata Menu can track it independently of the source note type. Field type, options, and nesting path are preserved from the source.

The new note type definition file opens automatically after creation.

> **Note:** The Metadata Menu public API covers field-value operations only and does not expose fileClass creation. The clone is written directly to the vault using the same `processFrontMatter` mechanism Metadata Menu itself uses to maintain fileClass definitions.

---

### Rename note type

**Typed Note Workflows: Rename note type** opens a dialog with a note type selector and a new
name. The active note's note type is selected initially. The command is also available
from a note type definition's file-explorer context menu. Names must be unique,
including case-insensitive collisions, and omit `.md`. Include the relative
subfolder for nested names, such as `work/project`.

The command renames the schema note in the configured note types folder and scans
every Markdown file in the vault, including templates and schema notes. It
replaces exact occurrences of the old note type in the configured note type field,
preserving scalar values, lists, and legacy comma-separated declarations.
Child schemas' `extends` references and child-class selections in Metadata Menu
saved views are updated. Field definitions, field IDs,
unrelated properties, and note contents are retained. Existing note filenames
and directories stay unchanged; Obsidian updates links to the renamed schema
according to the vault's link-update preference.

Standalone, Fileclass, and Metadata Menu use the same schema-file migration.
When the selected integration manages that schema folder, the command also
updates declarations using its alias, its global class setting, and Metadata
Menu query bindings' target class names. Existing implicit tag bindings are
preserved by adding the old class name to `tagNames`. Fileclass's implicit Base
view name is made explicit when necessary to keep the existing view accessible.
The last selected assignment note type and exact anchored literal patterns in
Typed Note Workflows' filename and path mappings are updated and saved.

Custom regex patterns, templates, Base filters, Dataview queries, and scripts
can contain class names as executable expressions; these require manual review.
The command does not search and replace arbitrary text inside them.

The scan reads current file contents. Invalid metadata or a name collision stops
the operation. A write failure triggers rollback of completed changes; concurrent
edits to affected properties stop the operation rather than being overwritten.
The dialog reports any files or settings that could not be restored. Cancel
before starting leaves the vault unchanged.

### Copy fields from…

Copies a selection of field definitions from one note type into another that already exists.

**Entry points:**
- **Command palette** — the active file must be a note type definition in your note types folder. It becomes the target.
- **File explorer right-click** — right-click any note type definition file and choose **Copy fields from…**. That file becomes the target.

**Flow:**
1. A source note type suggester opens (all note types except the target are listed).
2. A dialog shows all fields from the source, with:
   - Fields **new to the target** — checked by default (will be added).
   - Fields **already present in the target** — unchecked by default and marked with an <kbd>overwrite</kbd> badge. Check them to replace their existing definition.
   - Rename and reorder all included fields before confirming, as in the clone dialog.
3. Click **Copy**.

Merge behaviour in the target's frontmatter:
- **New fields** are appended to `fields[]` and `fieldsOrder[]`.
- **Overwritten fields** replace their existing definition in place, preserving their position in `fieldsOrder[]` and their existing Metadata Menu field ID (so MM's index remains consistent).

A notice confirms how many fields were added and how many were overwritten.

---

### Assign note type

Assigns the active note to a selected note type using the configured note type field
(such as `fileClass`). The dialog provides these options:

| Option | Choices | Default |
|---|---|---|
| Update file location | Enable or disable automatic location changes. | Enabled |
| Auto-rename | Apply filename rules using the current title and the new note type. | Enabled |
| Auto-reshelve | Apply the new note type's folder rules. | Enabled |
| Add missing fields | Add absent fields using the complete applicable schema. | Enabled |
| Remove fields outside the new schema | Only if empty; even if not empty; never (preserve all fields). | Only if empty |
| Sort fields | Following schema; alphabetically; do not sort. | Following schema |
| New fields, when not sorting | Prepended or appended; retain existing field order. | Appended |

Rename and reshelve work independently. Turning off file-location changes keeps
both the current filename and folder. The file extension is preserved. Filename
and folder rules can still use the note's current title, dates, and other values
even if the metadata removal policy removes those fields.

Click **Review fields** to open the same schema-driven editor used when creating
a note. It shows the new note type's fields, inherited and contextual fields, and
extra fields retained by your removal policy. Existing values are prefilled from
the note's current contents. Only absent fields get defaults, including the
current date/time for new date/time fields. When **Add missing fields** is off,
new fields are displayed but are saved only if you edit them.

Untouched values retain their original types and contents, including nulls,
blanks, `false`, zero, lists, and nested data. Values incompatible with the new
schema and unresolved links are shown in a JSON editor so they remain visible
and editable. **Use schema input** explicitly replaces such a value with the new
field type's default and opens its typed control. Nested edits retain undeclared child
properties. File pickers use the saved note as their Base query context; unsaved
form edits are not visible to filters using `this`.

When auto-rename is enabled, the editor includes the configured title field. A
missing, null, or blank title is prefilled with the current filename without its
extension. An edited title is saved even if the new schema does not declare it
or automatic insertion is disabled. It follows the selected field-order policy.
Bulk assignment continues to use the smaller title prompt and skips a note if
that prompt is cancelled.

The editor previews the destination and lists fields scheduled for removal.
Edited metadata drives the filename and folder rules; fields required by a new
destination appear in the editor. Click **Assign note type** to apply the edit.
Cancel or close the editor to leave the note unchanged. Validation errors and
filename collisions keep the editor open with your entries intact.

The note type field is always set to the selected note type. Adding missing fields leaves
existing values intact, including empty values. Inherited fields and fields from
remaining contextual classes count as part of the schema. "Even if not empty"
deletes fields outside that schema even when they contain values. "Never: preserve all fields" retains all existing
fields while updating the note type field. Schema or alphabetical sorting reorders
the complete frontmatter; unsorted insertion arranges only new fields in schema
order at the selected end.

Click **Review fields** to save every option, including the selected note type, in
`data.json` under `typeAssignment`. These choices are restored after restarting
Obsidian, even if you subsequently cancel the field editor. Cancelling the options
dialog discards its changes. If the
remembered note type is no longer available, the dialog selects the current note type
when available, otherwise the first available note type.

Assignment replaces the explicit note type selection, including an existing list, with
the selected note type. Tag and bookmark bindings remain applicable, and global classes
follow the selected integration's rules. Folder bindings are evaluated at the destination; disabling location changes retains
the current folder's bindings. Tags that bind classes are preserved even when
not declared as schema fields. Neither tags nor external binding rules are
silently rewritten to force a note into only one class.

The command checks the destination before updating metadata. A collision stops
the assignment. The move must succeed before metadata removal begins. If the
metadata write fails or the note/schema changes during preparation, the command
attempts to restore the original location and reports any restoration failure.
Creation and single-note assignment share `TypedNoteFieldsModal`, `TypedNoteFieldService`,
and `TypedNoteFilePickerModal`. Assignment, reshelving, and vault curation use
`TypedNoteUpdateService` for planning and guarded relocation; metadata removal and
ordering stay in `FrontmatterService`. Cleanup's interactive
preview applies only to the exact metadata snapshot the user reviewed.

### Bulk assign note type

Assigns a chosen note type to a scoped set of notes in one operation, with a per-file preview and selection step before anything is written.

**Step 1 — Configure**

- **Note type** — the note type value that will be written into the note type field of every matched file.

*Scope*
- **Directory** — vault-relative folder to operate on, with autocomplete. Leave blank for the vault root.
- **Recursive** — whether to include notes in subdirectories.

*Filters*
- **Include pattern** — regex that file paths must match (e.g. `^projects/`). Leave blank to include all.
- **Exclude pattern** — regex that file paths must not match (e.g. `^system/`). Leave blank to exclude none.

*Post-assign operations* (all default to on)
- **Clean frontmatter** — standard (add missing, preserve everything else) or strict (add missing, remove undefined).
- **Sort frontmatter** — schema order or alphabetical. When clean is also enabled, sorting is folded into the same pass.
- **Reshelve files** — move and rename each file to match its new note type and title, using the same path/filename mapping logic as the standalone Reshelve command.

> All three post-assign operations default to **on**. Disable any you don't need before clicking Preview.

**Step 2 — Preview**

A scrollable checklist shows every matched file. Files that already have a note type display it as `← current-note-type` so you can spot re-assignments at a glance. All files are checked by default; use **Select all** / **Select none** or click individual checkboxes to refine the selection. The summary line updates live.

Clicking **Assign** commits the operation on the checked files only.

---

### Curate vault (clean / sort / reshelve)

Batch-applies any combination of clean, sort, and reshelve operations across a scoped set of notes. A configuration dialog lets you specify:

**Scope**
- **Directory** — vault-relative folder to operate on, with autocomplete. Leave blank for the vault root.
- **Recursive** — whether to include notes in subdirectories.

**Filters**
- **Include pattern** — regex that file paths must match (e.g. `^projects/`). Leave blank to include all.
- **Exclude pattern** — regex that file paths must not match (e.g. `^system/`). Leave blank to exclude none.

**Operations** (enable any combination)
- **Clean frontmatter** — standard (add missing, preserve everything else) or strict (add missing, remove undefined).
- **Sort frontmatter** — schema order or alphabetical.
- **Reshelve files** — move and rename each note to match its note type and title.

---

### Clean workspace

Closes all open tabs except one and collapses the file explorer. A quick reset to a clean working state.

---

## Settings reference

### Note type definitions

| Setting | Description | Default |
|---|---|---|
| **Schema source** | Automatic (Fileclass, then Metadata Menu, then standalone), or select a source explicitly. | Automatic |
| **Note types path** | Vault folder containing note type definitions. Each definition is a Markdown note. Leave empty to read from the selected integration. | *(auto)* |
| **Fallback note types path** | Standalone schema folder when no Note types path is set. | `system/schema/content-types` |

### Field names

| Setting | Description | Default |
|---|---|---|
| **Note type field** | Frontmatter field that records the note type. Read from the selected integration; standalone defaults to `fileClass`. | *(auto)* |
| **Title field** | Frontmatter field used as the human-readable title of a note. Referenced as `{{ title }}` in path and filename templates. | `title` |

### Behaviour

| Setting | Description | Default |
|---|---|---|
| **Wrap around navigation** | When navigating past the last note of a note type, wrap to the first (and vice versa). | On |
| **Default field sort** | Sort order used by *Sort frontmatter* and the non-interactive clean commands. | Schema order |
| **Typed note list sort direction** | Order for note lists in *Open typed note by note type* and navigation. Descending puts the most recent date-prefixed filenames first. | Descending |
| **Maximum title length** | Maximum characters taken from the title field when constructing filenames. Longer titles are truncated at this limit. | `120` |
| **Date format** | Moment.js format string for date fields written into new notes. | `YYYY-MM-DDTHH:mm` |
| **Date prefix source fields** | Frontmatter fields checked (in order) for the date used in filename prefixes when reshelving. Falls back to file creation time. One field per line. | `date-indexed`, `date-created`, `created-date`, `created`, `date` |

### Typed note catalog defaults

Pre-filled defaults for the *Create typed note catalog* dialog, overridable at creation time.

| Setting | Description | Default |
|---|---|---|
| **Catalog directory** | Vault folder for new `.base` catalog files. Use `{{ content-type }}` to insert the note type name. Leave blank for vault root. | *(root)* |
| **Catalog filename** | Filename template for new catalog files. | `{{ content-type }}.base` |
| **Remap field names to display names** | Automatically convert schema field names to sentence-case column headers in catalogs. | On |
| **Include "date created" column** | Add a `file.ctime` column to new catalogs, with configurable display name. | On / `Date file created` |
| **Include "date modified" column** | Add a `file.mtime` column to new catalogs, with configurable display name. | On / `Date file modified` |

### Path mappings

Controls which vault folder a typed note is filed into, based on its note type value. Each mapping is a **[regex pattern, LiquidJS template]** pair. The first pattern that matches the note type value wins.

Regex capture groups are available as `$1`, `$2`, etc. All frontmatter fields are available as template variables.

**Examples**

| Pattern | Template | Result for an `article` note |
|---|---|---|
| `^(.+)$` | `content/$1` | `content/article` |
| `^(.+)$` | `{% if section %}{{ section }}/{% endif %}$1` | `projects/article` (when `section: projects`) |

Mappings can be reordered by drag-and-drop. The default maps every note type to `content/<note-type>`.

### Filename mappings

Controls how typed notes are named, based on their note type. Same **[regex pattern, LiquidJS template]** structure as path mappings. `{{ date }}` expands to a `YYYYMMDDTHHmm` timestamp; all frontmatter fields are available as variables.

**Examples**

| Pattern | Template | Result |
|---|---|---|
| `^.*$` | `{{ date }}--{{ title }}` | `20240315T0930--My Article` |
| `^book$` | `{{ date }}--{{ author \| default: "unknown" }}--{{ title }}` | `20240315T0930--Borges--Labyrinths` |
| `^log$` | `{{ date }}` | `20240315T0930` |

The full [LiquidJS template syntax](https://liquidjs.com/tutorials/intro-to-liquid.html) is available:

```
{{ field }}                                        — field value
{{ field | default: "fallback" }}                  — fallback when field is absent
{% if field %}/{{ field }}{% endif %}              — include only when present
{% if flag %}archived/{% else %}live/{% endif %}   — conditional branch
{% if tag %}[{{ tag }}]{% endif %}                 — surround value in brackets
```

The default maps every note type to `{{ date }}--{{ title }}`.

---

## Acknowledgements

Typed Note Workflows supports the fileClass schema format maintained by mdelobelle in [Fileclass](https://github.com/mdelobelle/fileclass) and [Metadata Menu](https://github.com/mdelobelle/metadatamenu), and uses [LiquidJS](https://liquidjs.com) for path and filename templating.
