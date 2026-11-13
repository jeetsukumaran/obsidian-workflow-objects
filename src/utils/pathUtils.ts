import { App, TFile } from "obsidian";
import { Liquid } from "liquidjs";
import { WorkflowObjectsSettings } from "../types";
import { sanitizeFilename } from "./helpers";

const DATE_PREFIX_REGEX = /^(\d{8}T\d{4})--/;

// ─── Liquid engine ─────────────────────────────────────────────────────────────

/**
 * Shared LiquidJS engine used by path/filename templates and catalog templates.
 *
 * Options:
 *   strictVariables: false → undefined context keys resolve to '' rather than
 *                            throwing, which is the right behaviour for optional
 *                            frontmatter fields.
 *   strictFilters:   false → unknown filter names are silently ignored so a
 *                            mis-typed filter in user settings doesn't crash the
 *                            plugin.
 */
export const liquidEngine = new Liquid({
    strictVariables: false,
    strictFilters: false,
});

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of computing file path information.
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

/** Existing path components that should bypass the corresponding mapping rules. */
interface FilePathOverrides {
    folder?: string;
    basename?: string;
    extension?: string;
}

/**
 * Template context passed to LiquidJS.  Values are kept at their native JS
 * types so that LiquidJS truthiness (nil/false → falsy, everything else →
 * truthy) aligns with YAML booleans parsed by Obsidian.  The reserved `date`
 * key holds the YYYYMMDDTHHmm date-prefix string.
 */
export type TemplateContext = Record<string, unknown>;

// ─── Template engine ──────────────────────────────────────────────────────────

/**
 * Expand a LiquidJS template string using the provided context.
 *
 * Full LiquidJS syntax is available.  Common patterns:
 *
 *   {{ title }}
 *   {{ role | default: "artifact" }}
 *   {% if section %}/{{ section }}{% endif %}{{ title }}
 *   {% if tag %}[{{ tag }}]{% endif %}
 *   {% if archived %}archived/{% else %}live/{% endif %}{{ date }}--{{ title }}
 *
 * The `date` key is reserved and pre-populated with the YYYYMMDDTHHmm prefix.
 * All other keys are drawn from the note's frontmatter.
 *
 * See https://liquidjs.com/tutorials/intro-to-liquid.html for full syntax.
 */
export async function expandTemplate(template: string, ctx: TemplateContext): Promise<string> {
    const result: string = await liquidEngine.parseAndRender(template, ctx);
    return result;
}

// ─── Path / filename helpers ──────────────────────────────────────────────────

/**
 * Determine destination folder based on content-type and path mappings.
 *
 * Each mapping is `[regexPattern, liquidTemplate]`.  Regex capture groups are
 * expanded first (`$1`, `$2`, …), then the result is processed as a LiquidJS
 * template with the full frontmatter context.
 */
export async function getDestinationFolder(
    typeValue: string | null | undefined,
    pathMappings: [string, string][],
    ctx: TemplateContext = {}
): Promise<string | null> {
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
 * Generate a date prefix in YYYYMMDDTHHmm format.
 */
export function generateDatePrefix(date?: Date): string {
    const d = date || new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Extract date prefix from an existing filename if present.
 */
export function extractDatePrefix(basename: string): string | null {
    const match = basename.match(DATE_PREFIX_REGEX);
    return match ? match[1] : null;
}

/**
 * Get filename template based on content-type and filename mappings.
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
    return "{{ date }}--{{ title }}";
}

/**
 * Build a basename from a LiquidJS template using the provided context.
 * `{{ date }}` expands to `datePrefix`; all other tokens expand via the context.
 */
export async function buildFilenameFromPattern(
    pattern: string,
    ctx: TemplateContext,
    datePrefix: string,
    maxTitleLength: number
): Promise<string> {
    const titleRaw = ctx["title"];
    const titleStr = typeof titleRaw === "string" ? titleRaw : "";
    const sanitizedTitle = titleStr
        ? sanitizeFilename(titleStr).slice(0, maxTitleLength)
        : "";
    const fullCtx: TemplateContext = {
        ...ctx,
        title: sanitizedTitle || "untitled",
        date: datePrefix,
    };

    const result = (await expandTemplate(pattern, fullCtx)).trim();
    return result || `${datePrefix}--untitled`;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Compute full file path info for a new or existing workflow object.
 *
 * @param settings             Plugin settings
 * @param typeValue            Content-type frontmatter value
 * @param title                Note title
 * @param existingDatePrefix   Date prefix extracted from the existing filename (reshelve)
 * @param ctime                File creation timestamp in ms (reshelve fallback)
 * @param frontmatter          Full frontmatter record — all fields available in templates
 */
export async function computeFilePath(
    settings: WorkflowObjectsSettings,
    typeValue: string | null | undefined,
    title: string | null | undefined,
    existingDatePrefix?: string | null,
    ctime?: number,
    frontmatter: Record<string, unknown> = {},
    overrides: FilePathOverrides = {}
): Promise<FilePathInfo> {
    // Preserve native JS types so that LiquidJS truthiness aligns with YAML
    // booleans (boolean false → falsy, nil → falsy, everything else → truthy).
    const ctx: TemplateContext = { ...frontmatter };
    if (title != null) ctx["title"] = title;

    const folder = overrides.folder ?? (await getDestinationFolder(typeValue, settings.pathMappings, ctx)) ?? "";

    const datePrefix =
        existingDatePrefix ||
        (ctime ? generateDatePrefix(new Date(ctime)) : null) ||
        generateDatePrefix();

    const basename = overrides.basename ?? await buildFilenameFromPattern(
        getFilenamePattern(typeValue, settings.filenameMappings),
        ctx,
        datePrefix,
        settings.maxTitleLength
    );

    const filename = `${basename}.${overrides.extension ?? "md"}`;
    const fullPath = folder ? `${folder}/${filename}` : filename;

    return { fullPath, folder, basename, datePrefix };
}

/** Compute an existing note's path, independently applying rename and folder rules. */
export async function computeExistingFilePath(
    file: TFile,
    settings: WorkflowObjectsSettings,
    typeField: string,
    frontmatter: Record<string, unknown>,
    autoRename: boolean = true,
    autoReshelve: boolean = true
): Promise<FilePathInfo> {
    const frontmatterDate = resolveDateFromFrontmatter(frontmatter, settings.titlePrefixDateProperties);
    return computeFilePath(
        settings,
        frontmatter[typeField] as string | undefined,
        frontmatter[settings.fields.title] as string | undefined,
        frontmatterDate !== null ? null : extractDatePrefix(file.basename),
        frontmatterDate ?? file.stat.ctime,
        frontmatter,
        {
            folder: autoReshelve ? undefined : file.path.slice(0, Math.max(0, file.path.lastIndexOf("/"))),
            basename: autoRename ? undefined : file.basename,
            extension: file.extension,
        }
    );
}

/** Resolve the first valid date using the configured property precedence. */
function resolveDateFromFrontmatter(
    frontmatter: Record<string, unknown>,
    propertyNames: string[]
): number | null {
    for (const prop of propertyNames) {
        const value = frontmatter[prop];
        if (value instanceof Date) {
            const timestamp = value.getTime();
            if (!isNaN(timestamp)) return timestamp;
        } else if (typeof value === "number" && !isNaN(value)) {
            return value;
        } else if (typeof value === "string" && value.trim()) {
            const timestamp = Date.parse(value.trim());
            if (!isNaN(timestamp)) return timestamp;
        }
    }
    return null;
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
