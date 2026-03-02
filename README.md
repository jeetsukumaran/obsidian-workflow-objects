# Workflow Objects

An Obsidian plugin for managing typed notes ("workflow objects") with schema-aware frontmatter, automatic file placement, and vault-wide curation.

## Concepts

A **workflow object** is any note that has a `type` frontmatter field whose value matches a type definition in your schema folder. The plugin reads type definitions from [Metadata Menu](https://github.com/mdelobelle/metadatamenu) class files (or from a plain folder of notes) and uses them to:

- scaffold new notes with the correct fields and defaults
- enforce consistent field order and presence
- derive the correct filename and vault path from the note's own metadata
- navigate between objects of the same type

## Commands

| Command | Description |
|---|---|
| **Create new workflow object** | Choose a type, enter a title; the plugin scaffolds a new note with all schema fields populated to their defaults and places it at the correct path. |
| **Navigate to next workflow object of same type** | Open the next note that shares the current note's type value, sorted by filename. |
| **Navigate to previous workflow object of same type** | Open the previous note of the same type. |
| **Open workflow object by type** | Two-step fuzzy finder: select a type, then select a note from all objects of that type. |
| **Sort frontmatter** | Reorder the current note's frontmatter fields using the default sort mode (schema order or alphabetical, as configured). |
| **Sort frontmatter (schema order)** | Sort fields to match the sequence defined in the type definition. |
| **Sort frontmatter (alphabetical)** | Sort fields A–Z, ignoring the schema order. |
| **Clean frontmatter (interactive)** | Opens a modal to choose a cleanup profile and previews what will change before applying. |
| **Clean frontmatter (standard)** | Adds any missing schema fields with defaults; removes empty fields that are not in the schema. Defined fields are preserved even if empty. |
| **Clean frontmatter (strict)** | Adds missing schema fields; removes any field not in the schema, including non-schema fields that have values. |
| **Reshelve workflow object** | Move and rename the current note so its path and filename match what the mappings derive from its current metadata. Useful after editing the type or title. |
| **Curate vault (clean / sort / reshelve)** | Batch operation across a configurable scope of files. Choose any combination of clean, sort, and reshelve, with options for directory, recursion, and include/exclude filters. |
| **Clean workspace** | Close all editor tabs and collapse the file explorer. |

## Frontmatter cleanup profiles

| Profile | Preserve schema fields (even if empty) | Remove non-schema fields | Add missing schema fields |
|---|:---:|:---:|:---:|
| Standard | ✓ | — | ✓ |
| Strict | ✓ | ✓ | ✓ |

The interactive command also exposes "sort only" and "remove all empty" modes.

## File placement: path and filename mappings

The plugin derives where a workflow object should live from its frontmatter. Two mapping tables control this: one for the folder path, one for the filename. Both use the same matching and template syntax.

### How matching works

Each mapping is a `[pattern, template]` pair. The pattern is a regex matched against the note's type field value. The **first matching rule** wins. If no rule matches, the note goes to the vault root with a `YYYYMMDDTHHmm--title` filename.

### Template syntax

Templates expand `{{field}}` placeholders using the full frontmatter of the note — any field, not just title. The reserved key `{{date}}` expands to the date prefix (`YYYYMMDDTHHmm`).

Modifiers are stacked inside `{{...}}` separated by `::`:

| Modifier | Effect |
|---|---|
| `::prefix:<str>` | Prepend `<str>` **only** when the field has a value |
| `::suffix:<str>` | Append `<str>` **only** when the field has a value |
| `::default:<str>` | Use `<str>` when the field is absent or empty |

When a field is absent and no `::default` is set, the entire token collapses to an empty string (silently dropped). This makes optional path segments straightforward:

```
# Folder template: type folder, with optional role sub-folder
content/{{content-type}}{{production-role::prefix:/}}

# production-role = "editor"  →  content/article/editor
# production-role absent       →  content/article
```

Regex capture groups from the pattern are available as `$1`, `$2`, etc., substituted before `{{...}}` expansion:

```
Pattern:  ^([^/]+)/(.+)$
Template: archive/$1/$2/{{title}}
```

### Example path mappings

```
Pattern          Template
^article$        content/articles
^(.+)$           content/$1
```

### Example filename mappings

```
Pattern          Template
^reference$      @{{title}}
^log$            {{date}}
^.*$             {{date}}--{{title}}
```

Advanced examples using multiple modifiers:

```
# Include section in filename only if the field exists
{{date}}--{{section::suffix:--}}{{title}}

# Role prefix with fallback, then date and title
{{production-role::default:general}}--{{date}}--{{title}}

# Optional sub-folder segment using suffix
content/{{content-type}}{{status::prefix:/::suffix:s}}
# status = "draft"  →  content/article/drafts
# status absent     →  content/article
```

### Date prefix

The date portion of a filename is determined in this order:

1. An existing date prefix already present in the filename (preserved on reshelve)
2. The value of the first matching **date prefix source field** found in frontmatter
3. The file's creation time
4. The current time (for new objects)

## Vault curation

The **Curate vault** command opens a modal with the following options:

- **Directory** — limit scope to a specific folder (empty = entire vault)
- **Recursive** — include sub-folders
- **Include / exclude pattern** — filter files by path using a regex
- **Operations** — independently toggle clean, sort, and reshelve
- **Clean mode** — standard or strict (see cleanup profiles above)
- **Sort mode** — schema order or alphabetical

A summary notice reports how many files were cleaned, sorted, reshelved, and whether any errors occurred.

## Metadata Menu integration

When Metadata Menu is installed the plugin automatically reads its class files and uses them as type definitions, providing:

- field names and types for scaffolding new objects
- `fieldsOrder` for schema-order sorting
- typed defaults (dates, selects, booleans) populated to the correct format

If Metadata Menu is not installed, or you set a **Types path** in settings, the plugin reads type definitions from a plain folder of notes instead. Each note's filename becomes the type name; a `fields` frontmatter array defines the schema.

## Settings reference

### Type definitions

| Setting | Description |
|---|---|
| **Types path** | Vault path to the folder of type-definition notes. Leave empty to auto-read from Metadata Menu. |
| **Fallback types path** | Used when Metadata Menu is absent and Types path is not set. Default: `system/schema/content-types`. |

### Field names

| Setting | Description |
|---|---|
| **Type field** | Frontmatter field that classifies a note as a workflow object of a given type. Auto-detected from Metadata Menu; set manually to override. |
| **Title field** | Frontmatter field used as the note's human-readable title and as `{{title}}` in templates. Default: `title`. |

### Behaviour

| Setting | Description |
|---|---|
| **Wrap around navigation** | Wrap from last to first object (and vice versa) when navigating within a type. |
| **Default field sort** | Sort mode applied by the plain "Sort frontmatter" command: schema order or alphabetical. |
| **Object list sort direction** | Order of the file list in navigation and open-by-type. Descending puts the most recently timestamped filenames first. |
| **Maximum title length** | Characters taken from the title when building filenames. Titles are truncated before filesystem sanitisation. Default: 120. |
| **Date format** | Moment.js format written into date-type fields on new objects. Default: `YYYY-MM-DDTHH:mm`. |
| **Date prefix source fields** | Frontmatter fields checked (in order) to find the date for a filename prefix during reshelving. Falls back to file creation time. One per line. |

### Path mappings

Regex → folder template rules. Evaluated top to bottom; first match wins. Templates support `$1`/`$2` regex capture groups and any `{{field}}` token with optional `::prefix`, `::suffix`, and `::default` modifiers.

### Filename mappings

Regex → filename template rules. Same evaluation model. `{{date}}` expands to the date prefix; all other `{{field}}` tokens expand from frontmatter with the same modifier support.

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create `.obsidian/plugins/workflow-objects/` inside your vault.
3. Copy the three files into that folder.
4. Enable the plugin under **Settings → Community plugins**.

### Development

```bash
git clone <repo>
cd obsidian-workflow-objects
npm install
npm run dev
```

## License

MIT
