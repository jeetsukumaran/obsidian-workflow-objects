import { App } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { sanitizeFilename } from "./helpers";

const DATE_PREFIX_REGEX = /^(\d{8}T\d{4})--/;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of computing file path information
 */
export interface FilePathInfo {
    /** Full path including folder and extension */
    fullPath: string;
    /** Just the folder path */
    folder: string;
    /** Basename without extension */
    basename: string;
    /** Date prefix (YYYYMMDDTHHmm) */
    datePrefix: string;
}

/**
 * Template context: all values are pre-stringified.
 * Keys match frontmatter field names; "date" is the date prefix.
 */
export type TemplateContext = Record<string, string | null | undefined>;

type ConditionalType = "iftrue" | "iffalse" | "ifany" | "ifempty";

interface TemplateModifiers {
    prefix?: string;
    suffix?: string;
    default?: string;
    /** Conditional branch: emit `trueVal` (or `elseVal`) based on the field. */
    conditional?: { type: ConditionalType; trueVal: string; elseVal?: string };
}

// ─── Template engine ──────────────────────────────────────────────────────────

/**
 * A non-empty value that is not "false" or "0" is considered truthy.
 * This matches the YAML boolean/string representations Obsidian stores.
 */
function isTruthy(value: string | null): boolean {
    if (value === null) return false;
    const v = value.trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0";
}

/**
 * Parse `key:value` modifier pairs from a `::key:value(::key:value)*` string.
 * Each segment after splitting on `::` is `key:value`; the value may itself
 * contain colons (e.g. `::default:foo:bar`).
 *
 * Conditional modifiers (`iftrue`, `iffalse`, `ifany`, `ifempty`) accept an
 * optional else-branch separated by a single `:`:
 *   `iftrue:<trueVal>`          — emit trueVal when condition holds
 *   `iftrue:<trueVal>:<elseVal>` — emit elseVal otherwise
 * Values may themselves contain `{{field}}` placeholders; they are expanded
 * after the branch is chosen. They must not contain `::`.
 */
function parseModifiers(raw: string): TemplateModifiers {
    const mods: TemplateModifiers = {};
    for (const seg of raw.split("::")) {
        const colon = seg.indexOf(":");
        if (colon === -1) continue;
        const key = seg.slice(0, colon).trim();
        const rest = seg.slice(colon + 1); // everything after the first ":"
        if (key === "prefix") mods.prefix = rest;
        else if (key === "suffix") mods.suffix = rest;
        else if (key === "default") mods.default = rest;
        else if (key === "iftrue" || key === "iffalse" || key === "ifany" || key === "ifempty") {
            const sep = rest.indexOf(":");
            mods.conditional = {
                type: key,
                trueVal: sep === -1 ? rest : rest.slice(0, sep),
                elseVal: sep === -1 ? undefined : rest.slice(sep + 1),
            };
        }
    }
    return mods;
}

/**
 * Expand a single `{{field(::mod:val)*}}` token.
 *
 * Standard modifiers:
 *   `::prefix:<str>`   — prepend when field has a value
 *   `::suffix:<str>`   — append  when field has a value
 *   `::default:<str>`  — fallback when field is absent/empty
 *
 * Conditional modifiers (mutually exclusive with prefix/suffix/default):
 *   `::iftrue:<val>[:<else>]`  — if field is truthy emit val, else emit else (or "")
 *   `::iffalse:<val>[:<else>]` — if field is falsy  emit val, else emit else (or "")
 *   `::ifany:<val>[:<else>]`   — if field is non-empty emit val, else emit else (or "")
 *   `::ifempty:<val>[:<else>]` — if field is empty/absent emit val, else emit else (or "")
 *
 * Chosen conditional values are plain strings — they must not contain `{{...}}`
 * (the flat regex cannot handle nesting). Place dynamic tokens outside the
 * conditional token instead.
 */
function expandToken(field: string, modsRaw: string, ctx: TemplateContext): string {
    const mods = modsRaw ? parseModifiers(modsRaw) : {};
    const raw = ctx[field];
    const value = raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;

    if (mods.conditional) {
        const { type, trueVal, elseVal } = mods.conditional;
        const condition =
            type === "iftrue"  ?  isTruthy(value) :
            type === "iffalse" ? !isTruthy(value) :
            type === "ifany"   ?  value !== null   :
          /*type === "ifempty"*/  value === null;
        const chosen = condition ? trueVal : (elseVal ?? "");
        return chosen;
    }

    const resolved = value ?? (mods.default !== undefined ? mods.default : null);
    if (resolved === null) return "";
    return `${mods.prefix ?? ""}${resolved}${mods.suffix ?? ""}`;
}

/**
 * Expand all `{{field(::mod:val)*}}` placeholders in a template string.
 *
 * Standard modifiers (stackable via `::`):\n *   `::prefix:<str>`   — prepend <str> when the field has a value
 *   `::suffix:<str>`   — append  <str> when the field has a value
 *   `::default:<str>`  — use <str> when the field is absent or empty
 *
 * Conditional modifiers (each accepts an optional `:<else-val>` branch):
 *   `::iftrue:<val>[:<else>]`  — emit val when field is truthy (non-empty, not "false"/"0")
 *   `::iffalse:<val>[:<else>]` — emit val when field is falsy
 *   `::ifany:<val>[:<else>]`   — emit val when field is present/non-empty
 *   `::ifempty:<val>[:<else>]` — emit val when field is absent or empty
 *
 * Conditional values are plain strings. They must not contain `{{...}}` or `::`.
 * Place dynamic tokens outside the conditional instead:
 *   ✓ `{{archived::iftrue:archived/}}{{date}}--{{title}}`
 *   ✗ `{{archived::iftrue:archived/{{date}}--{{title}}}}`  ← regex ambiguity
 *
 * The `date` key is reserved and should be pre-populated in the context.
 *
 * Examples:
 *   `{{title}}`
 *   `{{role::default:artifact}}`
 *   `{{archived::iftrue:archived/}}`
 *   `{{archived::iftrue:archived/:live/}}`
 *   `{{tag::ifany:tags/{{tag}}/}}`
 *   `{{title::prefix:+++::suffix:/}}`
 */
export function expandTemplate(template: string, ctx: TemplateContext): string {
    // Match {{fieldname}} or {{fieldname::modifiers}}
    // fieldname: word chars + hyphens; modifiers: everything up to }}
    return template.replace(/\{\{([\w][\w-]*)(?:::((?:[^}](?!\}\})|[^}])*))?\}\}/g, (_, field, modsRaw) => {
        return expandToken(field, modsRaw ?? "", ctx);
    });
}

// ─── Path / filename helpers ──────────────────────────────────────────────────

/**
 * Determine destination folder based on content-type and path mappings.
 * Templates support regex group substitution (`$1`, `$2`) AND `{{field}}` expansion.
 */
export function getDestinationFolder(
    typeValue: string | null | undefined,
    pathMappings: [string, string][],
    ctx: TemplateContext = {}
): string | null {
    if (!typeValue) return null;

    for (const [pattern, template] of pathMappings) {
        const match = typeValue.match(new RegExp(pattern));
        if (match) {
            const withGroups = template.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] || "");
            return expandTemplate(withGroups, ctx);
        }
    }
    return null;
}

/**
 * Generate a date prefix in YYYYMMDDTHHmm format
 */
export function generateDatePrefix(date?: Date): string {
    const d = date || new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Extract date prefix from an existing filename if present
 */
export function extractDatePrefix(basename: string): string | null {
    const match = basename.match(DATE_PREFIX_REGEX);
    return match ? match[1] : null;
}

/**
 * Get filename pattern based on content-type and filename mappings.
 * Falls back to the default date+title pattern.
 */
export function getFilenamePattern(
    typeValue: string | null | undefined,
    filenameMappings: [string, string][]
): string {
    if (typeValue) {
        for (const [pattern, template] of filenameMappings) {
            if (typeValue.match(new RegExp(pattern))) return template;
        }
    }
    return "{{date::YYYYMMDDTHHmm}}--{{title}}";
}

/**
 * Build a basename from a pattern template using the provided context.
 * `{{date}}` (or `{{date::*}}`) expands to `datePrefix`.
 * All other `{{field}}` tokens expand via the context map.
 */
export function buildFilenameFromPattern(
    pattern: string,
    ctx: TemplateContext,
    datePrefix: string,
    maxTitleLength: number
): string {
    // Sanitize title in context so the filename is safe.
    // Fall back to "untitled" so that patterns like {{date}}--{{title}} never
    // produce a bare "YYYYMMDDTHHmm--" basename when the title is absent.
    const titleRaw = ctx["title"];
    const sanitizedTitle = titleRaw
        ? sanitizeFilename(String(titleRaw)).slice(0, maxTitleLength)
        : "";
    const fullCtx: TemplateContext = {
        ...ctx,
        title: sanitizedTitle || "untitled",
        // date / date::FORMAT both resolve to the datePrefix
        date: datePrefix,
    };

    // Normalise {{date::FORMAT}} → {{date}} so expandTemplate handles it
    const normalised = pattern.replace(/\{\{date(?:::[^}]*)?\}\}/g, "{{date}}");
    const result = expandTemplate(normalised, fullCtx).trim();
    return result || `${datePrefix}--untitled`;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Compute full file path info for a new or existing workflow object.
 *
 * @param settings         Plugin settings
 * @param typeValue        Content-type frontmatter value
 * @param title            Note title
 * @param existingDatePrefix  Date prefix extracted from the existing filename (reshelve)
 * @param ctime            File creation timestamp in ms (reshelve fallback)
 * @param frontmatter      Full frontmatter record — all fields are available in templates
 */
export function computeFilePath(
    settings: WorkflowObjectsSettings,
    typeValue: string | null | undefined,
    title: string | null | undefined,
    existingDatePrefix?: string | null,
    ctime?: number,
    frontmatter: Record<string, unknown> = {}
): FilePathInfo {
    // Build template context from frontmatter; coerce all values to strings
    const ctx: TemplateContext = {};
    for (const [k, v] of Object.entries(frontmatter)) {
        if (v === null || v === undefined) {
            ctx[k] = undefined;
        } else if (typeof v === "object") {
            ctx[k] = JSON.stringify(v);
        } else if (typeof v === "string") {
            ctx[k] = v;
        } else {
            ctx[k] = String(v as number | boolean | bigint | symbol);
        }
    }
    // Ensure title is in context (may override frontmatter value if passed explicitly)
    if (title != null) ctx["title"] = title;

    const folder = getDestinationFolder(typeValue, settings.pathMappings, ctx) ?? "";

    const datePrefix =
        existingDatePrefix ||
        (ctime ? generateDatePrefix(new Date(ctime)) : null) ||
        generateDatePrefix();

    const filenamePattern = getFilenamePattern(typeValue, settings.filenameMappings);
    const basename = buildFilenameFromPattern(filenamePattern, ctx, datePrefix, settings.maxTitleLength);

    const fullPath = folder ? `${folder}/${basename}.md` : `${basename}.md`;

    return { fullPath, folder, basename, datePrefix };
}

// ─── Folder creation ──────────────────────────────────────────────────────────

/**
 * Ensure a folder exists, creating it and parent folders if necessary.
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
    if (!folderPath) return;
    if (app.vault.getAbstractFileByPath(folderPath)) return;

    const parts = folderPath.split("/");
    let currentPath = "";
    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!app.vault.getAbstractFileByPath(currentPath)) {
            await app.vault.createFolder(currentPath);
        }
    }
}
