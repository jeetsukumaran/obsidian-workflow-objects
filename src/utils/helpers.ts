import { App, TFile, Notice } from "obsidian";
import { ActiveFileWithMeta } from "../types";
import { moment } from "obsidian";

/**
 * Get active file with its frontmatter
 * @param app Obsidian app instance
 * @param requireField If specified, return null (with notice) if field missing
 */
export function getActiveFileWithMeta(
    app: App,
    requireField: string | null = null
): ActiveFileWithMeta | null {
    const file = app.workspace.getActiveFile();
    if (!file) {
        new Notice("No active file");
        return null;
    }
    if (file.extension !== "md" && file.extension !== "qmd") {
        new Notice("Only markdown files are supported");
        return null;
    }
    const frontmatter =
        app.metadataCache.getFileCache(file)?.frontmatter || {};

    if (requireField && !frontmatter[requireField]) {
        new Notice(`No "${requireField}" in current note`);
        return null;
    }

    return { file, frontmatter };
}

/**
 * Find all markdown files where a frontmatter field equals a given value
 * @param app Obsidian app instance
 * @param fieldName The frontmatter field to filter on
 * @param value The value to match
 * @param sortDirection Sort direction: 'asc' for ascending (A-Z), 'desc' for descending (Z-A)
 */
export function getFilesByField(
    app: App,
    fieldName: string,
    value: string,
    sortDirection: "asc" | "desc" = "asc"
): TFile[] {
    const files = app.vault
        .getMarkdownFiles()
        .filter(
            (f) =>
                app.metadataCache.getFileCache(f)?.frontmatter?.[fieldName] ===
                value
        );

    if (sortDirection === "desc") {
        return files.sort((a, b) => b.path.localeCompare(a.path));
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Open a file in the current leaf
 */
export async function openFile(app: App, file: TFile): Promise<void> {
    await app.workspace.getLeaf().openFile(file);
}

/**
 * Get current editor selection, or empty string
 */
export function getSelection(app: App): string {
    return app.workspace.activeEditor?.editor?.getSelection() || "";
}

/**
 * Sanitize a string for use as a filename
 */
export function sanitizeFilename(str: string): string {
    return str
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Check if a frontmatter value is "empty"
 */
export function isEmptyValue(v: unknown): boolean {
    if (v == null) return true;
    if (typeof v === "string" && (v.trim() === "" || v.trim() === "Null"))
        return true;
    if (
        Array.isArray(v) &&
        (v.length === 0 ||
            v.every(
                (i) =>
                    i == null || (typeof i === "string" && i.trim() === "")
            ))
    )
        return true;
    if (
        typeof v === "object" &&
        !Array.isArray(v) &&
        Object.keys(v).length === 0
    )
        return true;
    return false;
}

/**
 * Format a value for YAML frontmatter output
 */
export function formatYamlValue(value: unknown): string {
    if (value === null) return "null";
    if (value === "") return '""';
    if (typeof value === "boolean") return value.toString();
    if (typeof value === "number") return value.toString();
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        return (
            "\n" + value.map((v) => `  - ${formatYamlValue(v)}`).join("\n")
        );
    }
    if (typeof value === "string") {
        if (/[:[\]{}#&*!|>'"%@`]/.test(value) || value.includes("\n")) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return value;
    }
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Format a value for display in confirmation dialog
 */
export function formatValueForDisplay(value: unknown): string {
    if (value === null || value === undefined) return "(null)";
    if (value === "") return '""';
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        if (value.length <= 3) return `[${value.join(", ")}]`;
        return `[${value.slice(0, 3).join(", ")}, ... (${value.length} items)]`;
    }
    if (typeof value === "object") return JSON.stringify(value);
    const str = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
    if (str.length > 50) return str.slice(0, 47) + "...";
    return str;
}

/**
 * Sort mode for frontmatter fields
 */
export type SortMode = "schema" | "alphabetical" | "none";

/**
 * Sort an array of key-value entries according to the specified mode
 * @param entries Array of [key, value] tuples
 * @param fieldOrder Schema field order (only used when mode is "schema")
 * @param mode Sort mode: "schema" for type definition order, "alphabetical" for A-Z, "none" for no sorting
 */
export function sortEntries(
    entries: [string, unknown][],
    fieldOrder: string[] | null,
    mode: SortMode
): [string, unknown][] {
    if (mode === "none") {
        return entries;
    }

    if (mode === "alphabetical" || !fieldOrder || fieldOrder.length === 0) {
        return [...entries].sort(([a], [b]) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
    }

    // Schema mode with valid field order
    const priorityMap = new Map<string, number>();
    fieldOrder.forEach((name, index) => priorityMap.set(name, index));

    const inSchema = entries.filter(([key]) => priorityMap.has(key));
    const notInSchema = entries.filter(([key]) => !priorityMap.has(key));

    inSchema.sort((a, b) => priorityMap.get(a[0])! - priorityMap.get(b[0])!);
    notInSchema.sort(([a], [b]) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    return [...inSchema, ...notInSchema];
}

/**
 * Get default value for a Metadata Menu field type
 */
export function getDefaultValueForType(
    fieldType: string,
    options: Record<string, unknown> = {},
    dateFormat: string = "YYYY-MM-DDTHH:mm"
): unknown {
    const format = (options.dateFormat as string) || dateFormat;
    const now = moment().format(format);

    switch (fieldType) {
        case "DateTime":
        case "Date":
            return now;
        case "Input":
        case "Textarea":
            return "";
        case "Number":
            return null;
        case "Boolean":
        case "Checkbox":
            return false;
        case "Select":
        case "Cycle":
        case "File":
            return null;
        case "Multi":
        case "MultiFile":
            return [];
        default:
            return null;
    }
}
