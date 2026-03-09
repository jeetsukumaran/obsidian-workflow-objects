# Workflow Objects

An Obsidian plugin for "typed object" note workflows.

This plugin serves to implement the metadata schemas associated with notes of particular file classes, as defined and managed using [Metadata Menu](https://github.com/mdelobelle/metadatamenu), to curate typed-note file names, locations, and frontmatter.

---

<details>
<summary><strong>Typed notes as objects</strong></summary>

A typed note is an ordinary Markdown note that has a *type*.
Corresponding to each specific note type are a set of specific properties, that are the *fields* of the "typed note object.
A note of type `article` carries fields like `author`, `status`, and `rating`; a note of type `project` carries `deadline`, `team`, and `priority`.



</details>

---

## Relationship to Metadata Menu

Workflow Objects is designed as a **companion to [Metadata Menu](https://github.com/mdelobelle/metadatamenu)**. The two plugins divide responsibilities cleanly:

| | Metadata Menu | Workflow Objects |
|---|---|---|
| **Role** | Schema manager | Note and frontmatter curator |
| **Defines** | What each type of object *is* — its fields, their types, their defaults | Where objects *live*, how they are *named*, how their frontmatter is *kept consistent* |
| **Manages** | Editing field values in-note via menus and forms | Creating, filing, sorting, cleaning, navigating, and cataloguing typed notes |

Metadata Menu defines what an `article` object is — that is, a note with a metadata-defined schema of the `article` type: which fields it has, what types they are, what their defaults should be. Workflow Objects *implements* that definition across the vault: it creates new `article` objects (notes conforming to the `article` type schema) pre-populated with those fields, files them in the right folder with the right filename, keeps their frontmatter tidy as the schema evolves, lets you navigate sequentially between `article` objects, and generates an Obsidian Bases `.base` file that serves as a live catalog of every `article` object in the vault.

Together, the two plugins transform a vault of loosely structured notes into a vault of typed objects — Metadata Menu as the schema manager, Workflow Objects as the curator that implements those schemas in practice.

If Metadata Menu is installed, Workflow Objects auto-detects its type-field alias (`fileClass` by default) and reads type definitions directly from the Metadata Menu fileClass folder — no duplicate configuration needed. It can also operate without Metadata Menu, reading type definitions from any folder of notes you designate.

---

## Installation

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **Workflow Objects** and install.
3. Enable the plugin.

**Manual installation:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jeetsukumaran/obsidian-workflow-objects/releases/latest) and copy them to `.obsidian/plugins/workflow-objects/` inside your vault.

---

## Type definitions

The plugin reads type schemas from a folder of Markdown notes. Each note's **filename** is the type name — `article.md` defines the `article` type, `project.md` defines the `project` type, and so on. The note's **frontmatter** carries the field schema in Metadata Menu's fileClass format:

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

If Metadata Menu is installed, this folder is read automatically from its settings. Otherwise, set **Types path** in the plugin settings.

---

## Commands

All commands are available from the Command Palette (`Ctrl/Cmd+P`).

---

### Create new workflow object

Prompts for a type, then a title. Creates a new typed note — that is, a new object of the chosen type — pre-populated with all fields defined in that type's schema (with their default values). The note is filed at the path and given the filename determined by your **path mappings** and **filename mappings** settings.

---

### Navigate to next / previous workflow object of same type

From any typed note (object), jumps to the next or previous note of the same type, sorted by filename. Wraps around at the boundary unless wrap-around navigation is disabled in settings.

Useful for paging through all objects of a given type in sequence — all your `book` objects (notes of the `book` type), all your `project` objects, and so on.

---

### Open workflow object by type

Two-step picker: first choose a type, then choose a note from the list of all objects of that type (all notes whose type field matches). The list is sorted by filename, newest-first by default when filenames carry date prefixes.

---

### Reshelve workflow object

Moves and renames the active note to match its current frontmatter — applying your path and filename template settings to its type and title fields. Use this after changing a note's type or title, or after updating your path mapping rules, to bring the object into its correct location.

If the filename already encodes a date prefix (e.g. `20240315T0930--my-note.md`), that prefix is preserved unless the frontmatter contains a more authoritative date field (see *Date prefix source fields* in settings).

---

### Sort frontmatter

Reorders the active note's frontmatter fields using the default sort mode from settings (schema order or alphabetical). Equivalent to running *Sort frontmatter (schema order)* or *Sort frontmatter (alphabetical)* depending on your **Default field sort** setting.

---

### Sort frontmatter (schema order)

Reorders frontmatter fields to match the sequence defined in the type schema. Fields not present in the schema are moved to the end.

---

### Sort frontmatter (alphabetical)

Reorders frontmatter fields A–Z, regardless of schema.

---

### Clean frontmatter (interactive)

Opens a menu of cleanup actions for the active typed note (object). Each action is a preset combination of three independent operations: adding fields missing from the schema, removing fields not present in the schema, and sorting the result.

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

Non-interactive *ensure*: adds any fields missing from the type schema and preserves all existing fields — including those not in the schema — using the default sort from settings. Safe to run on any typed note (object).

---

### Clean frontmatter (strict)

Non-interactive *enforce*: adds missing fields **and removes** any fields not defined in the type schema, using the default sort from settings. Use with care — there is no confirmation dialog.

---

### Create new workflow object catalog

Generates an [Obsidian Bases](https://obsidian.md/bases) `.base` file that serves as a live catalog or index of all objects of a chosen type — that is, all notes whose type field matches the chosen type.

**Flow:**
1. Choose a type from the suggester.
2. Review or edit the destination directory and filename (pre-filled from your catalog settings).
3. Click **Create**.

The generated catalog (`.base` file) includes:

- A filter that selects all notes of the chosen type (all objects whose type field equals the chosen value).
- A **Title** column rendered as a clickable link using each object's title field.
- One column per schema field. Fields of type `File` (linked notes — references to other objects) are rendered as titled links to the target object; all other fields are shown as raw property values.
- Optional **Date created** and **Date modified** columns (controlled by settings).
- Sentence-case display names for all columns (e.g. `workflow-effort` → `Workflow effort`), unless remapping is disabled.

If a `.base` file already exists at the target path, a collision dialog offers three options: **Replace** (overwrite), **Rename** (enter a new filename), or **Cancel**.

---

### Clone object type

Creates a new object type (fileClass) as a copy of an existing one.

**Flow:**
1. Choose a source type from the suggester.
2. A dialog opens showing the new type's name (pre-filled as `<source>-copy`) and all fields from the source schema.
3. Edit the name — collisions with existing type names are caught and flagged live.
4. In the field list, for each field:
   - **Uncheck** the checkbox to omit the field from the clone entirely.
   - **Edit the name input** to rename the field in the clone (leave blank to keep the source name).
   - **Drag the row** or use the **↑ / ↓ buttons** to reorder fields.
5. Click **Clone**.

The new fileClass note is created in the same folder as your other type definitions (the Metadata Menu fileClass folder, or your configured Types path). It is populated with only the fields you kept, under the names and in the order you specified. Each field receives a fresh unique ID so Metadata Menu can track it independently of the source type. Field type, options, and nesting path are preserved from the source.

The new type definition file opens automatically after creation.

> **Note:** The Metadata Menu public API covers field-value operations only and does not expose fileClass creation. The clone is written directly to the vault using the same `processFrontMatter` mechanism Metadata Menu itself uses to maintain fileClass definitions.

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
- **Reshelve files** — move and rename each note to match its type and title.

---

### Clean workspace

Closes all open tabs except one and collapses the file explorer. A quick reset to a clean working state.

---

## Settings reference

### Type definitions

| Setting | Description | Default |
|---|---|---|
| **Types path** | Vault path to the folder of type-definition notes. Each note defines one object type (one class of typed notes). Leave empty to auto-read from Metadata Menu. | *(auto)* |
| **Fallback types path** | Path used when Metadata Menu is absent and no Types path is set. | `system/schema/content-types` |

### Field names

| Setting | Description | Default |
|---|---|---|
| **Type field** | Frontmatter field that records a note's object type. Auto-detected from Metadata Menu (`fileClass`) when left empty. | *(auto)* |
| **Title field** | Frontmatter field used as the human-readable title of an object. Referenced as `{{ title }}` in path and filename templates. | `title` |

### Behaviour

| Setting | Description | Default |
|---|---|---|
| **Wrap around navigation** | When navigating past the last object of a type, wrap to the first (and vice versa). | On |
| **Default field sort** | Sort order used by *Sort frontmatter* and the non-interactive clean commands. | Schema order |
| **Object list sort direction** | Order for note lists in *Open by type* and navigation. Descending puts the most recent date-prefixed filenames first. | Descending |
| **Maximum title length** | Maximum characters taken from the title field when constructing filenames. Longer titles are truncated at this limit. | `120` |
| **Date format** | Moment.js format string for date fields written into new objects. | `YYYY-MM-DDTHH:mm` |
| **Date prefix source fields** | Frontmatter fields checked (in order) for the date used in filename prefixes when reshelving. Falls back to file creation time. One field per line. | `date-indexed`, `date-created`, `created-date`, `created`, `date` |

### Object catalog defaults

Pre-filled defaults for the *Create new workflow object catalog* dialog, overridable at creation time.

| Setting | Description | Default |
|---|---|---|
| **Catalog directory** | Vault folder for new `.base` catalog files. Use `{{ content-type }}` to insert the type name. Leave blank for vault root. | *(root)* |
| **Catalog filename** | Filename template for new catalog files. | `{{ content-type }}.base` |
| **Remap field names to display names** | Automatically convert schema field names to sentence-case column headers in catalogs. | On |
| **Include "date created" column** | Add a `file.ctime` column to new catalogs, with configurable display name. | On / `Date file created` |
| **Include "date modified" column** | Add a `file.mtime` column to new catalogs, with configurable display name. | On / `Date file modified` |

### Path mappings

Controls which vault folder a typed note (object) is filed into, based on its type value. Each mapping is a **[regex pattern, LiquidJS template]** pair. The first pattern that matches the note's type value wins.

Regex capture groups are available as `$1`, `$2`, etc. All frontmatter fields are available as template variables.

**Examples**

| Pattern | Template | Result for an `article` object |
|---|---|---|
| `^(.+)$` | `content/$1` | `content/article` |
| `^(.+)$` | `{% if section %}{{ section }}/{% endif %}$1` | `projects/article` (when `section: projects`) |

Mappings can be reordered by drag-and-drop. The default maps every type to `content/<type>`.

### Filename mappings

Controls how typed notes (objects) are named, based on their type. Same **[regex pattern, LiquidJS template]** structure as path mappings. `{{ date }}` expands to a `YYYYMMDDTHHmm` timestamp; all frontmatter fields are available as variables.

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

The default maps every type to `{{ date }}--{{ title }}`.

---

## Acknowledgements

Workflow Objects relies on [Metadata Menu](https://github.com/mdelobelle/metadatamenu) by mdelobelle for type schema definitions, and uses [LiquidJS](https://liquidjs.com) for path and filename templating.
