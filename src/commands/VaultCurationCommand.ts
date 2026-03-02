import { App, Notice, TFile, TFolder } from "obsidian";
import { WorkflowObjectsSettings, CleanupOptions, DEFAULT_CLEANUP_OPTIONS } from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { VaultCurationModal, VaultCurationOptions } from "../modals/VaultCurationModal";
import {
    computeFilePath,
    extractDatePrefix,
    ensureFolderExists,
} from "../utils/pathUtils";

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Show the vault curation dialog and run the selected operations.
 */
export async function curateVault(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const modal = new VaultCurationModal(app, settings);
    const opts = await modal.openAndGetValue();
    if (!opts) return;

    // Validate regexes early
    let includeRe: RegExp | null = null;
    let excludeRe: RegExp | null = null;
    try {
        if (opts.includePattern) includeRe = new RegExp(opts.includePattern);
        if (opts.excludePattern) excludeRe = new RegExp(opts.excludePattern);
    } catch {
        new Notice("Invalid regex pattern — aborting");
        return;
    }

    const files = collectFiles(app, opts.directory, opts.recursive, includeRe, excludeRe);
    if (files.length === 0) {
        new Notice("No files matched the given scope and filters");
        return;
    }

    new Notice(`Starting curation on ${files.length} file(s)…`);

    const totals = { cleaned: 0, sorted: 0, reshelved: 0, errors: 0 };

    for (const file of files) {
        try {
            if (opts.runClean) {
                await runCleanOnFile(file, opts, settings, typeService, frontmatterService);
                totals.cleaned++;
            }
            if (opts.runSort) {
                await frontmatterService.sortFrontmatter(file, opts.sortMode);
                totals.sorted++;
            }
            if (opts.runReshelve) {
                const moved = await runReshelveOnFile(file, app, settings, typeService);
                if (moved) totals.reshelved++;
            }
        } catch (err) {
            console.error(`[curate-vault] Error on ${file.path}:`, err);
            totals.errors++;
        }
    }

    new Notice(buildSummaryMessage(totals, files.length));
}

// ─── File collection ──────────────────────────────────────────────────────────

/**
 * Collect markdown files under a directory, optionally filtered.
 */
function collectFiles(
    app: App,
    directory: string,
    recursive: boolean,
    includeRe: RegExp | null,
    excludeRe: RegExp | null
): TFile[] {
    const root = directory
        ? app.vault.getAbstractFileByPath(directory)
        : app.vault.getRoot();

    if (!root || !(root instanceof TFolder)) {
        return [];
    }

    const results: TFile[] = [];
    collectFromFolder(root, recursive, includeRe, excludeRe, results);
    return results;
}

function collectFromFolder(
    folder: TFolder,
    recursive: boolean,
    includeRe: RegExp | null,
    excludeRe: RegExp | null,
    out: TFile[]
): void {
    for (const child of folder.children) {
        if (child instanceof TFile) {
            // Only process markdown and Quarto markdown files
            if (child.extension !== "md" && child.extension !== "qmd") continue;
            if (includeRe && !includeRe.test(child.path)) continue;
            if (excludeRe && excludeRe.test(child.path)) continue;
            out.push(child);
        } else if (recursive && child instanceof TFolder) {
            collectFromFolder(child, recursive, includeRe, excludeRe, out);
        }
    }
}

// ─── Clean ────────────────────────────────────────────────────────────────────

async function runCleanOnFile(
    file: TFile,
    opts: VaultCurationOptions,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const cleanOptions: CleanupOptions =
        opts.cleanMode === "strict"
            ? {
                  preserveDefinedFields: true,
                  removeUndefinedFields: true,
                  addMissingFields: true,
                  sortMode: "none",
              }
            : {
                  ...DEFAULT_CLEANUP_OPTIONS,
                  sortMode: "none", // sort handled separately if opts.runSort
              };

    await frontmatterService.cleanFrontmatter(file, cleanOptions);
}

// ─── Reshelve ─────────────────────────────────────────────────────────────────

/**
 * Core reshelve logic, extracted so it can be called per-file without requiring
 * an active editor.  Returns true if the file was actually moved.
 */
export async function reshelveFile(
    file: TFile,
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<boolean> {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const typeField = typeService.getTypeFieldName();
    const typeValue = frontmatter[typeField] as string | undefined;
    const titleValue = frontmatter[settings.fields.title] as string | undefined;

    const existingPrefix = extractDatePrefix(file.basename);
    const frontmatterDate = resolveDateFromFrontmatter(
        frontmatter,
        settings.titlePrefixDateProperties
    );

    const pathInfo = frontmatterDate
        ? computeFilePath(settings, typeValue, titleValue, null, frontmatterDate, frontmatter)
        : computeFilePath(settings, typeValue, titleValue, existingPrefix, file.stat.ctime, frontmatter);

    if (file.path === pathInfo.fullPath) return false;

    await ensureFolderExists(app, pathInfo.folder);
    await app.fileManager.renameFile(file, pathInfo.fullPath);
    return true;
}

async function runReshelveOnFile(
    file: TFile,
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<boolean> {
    return reshelveFile(file, app, settings, typeService);
}

/**
 * Resolve a date timestamp from frontmatter properties.
 * (Mirrors the logic in ReshelveCommand, kept here to avoid circular deps.)
 */
function resolveDateFromFrontmatter(
    frontmatter: Record<string, unknown>,
    propertyNames: string[]
): number | null {
    for (const prop of propertyNames) {
        const value = frontmatter[prop];
        if (value == null) continue;

        if (value instanceof Date) {
            const ts = value.getTime();
            if (!isNaN(ts)) return ts;
            continue;
        }

        if (typeof value === "number" && !isNaN(value)) return value;

        if (typeof value === "string" && value.trim()) {
            const ts = Date.parse(value.trim());
            if (!isNaN(ts)) return ts;
        }
    }
    return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummaryMessage(
    totals: { cleaned: number; sorted: number; reshelved: number; errors: number },
    total: number
): string {
    const parts: string[] = [`Processed ${total} file(s)`];
    if (totals.cleaned) parts.push(`cleaned ${totals.cleaned}`);
    if (totals.sorted) parts.push(`sorted ${totals.sorted}`);
    if (totals.reshelved) parts.push(`reshelved ${totals.reshelved}`);
    if (totals.errors) parts.push(`${totals.errors} error(s) — see console`);
    return parts.join(" · ");
}
