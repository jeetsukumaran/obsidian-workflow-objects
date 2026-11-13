import { App, Notice, TFile, TFolder } from "obsidian";
import { WorkflowObjectsSettings, CleanupOptions, DEFAULT_CLEANUP_OPTIONS } from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { VaultCurationModal, VaultCurationOptions } from "../modals/VaultCurationModal";
import {
    computeExistingFilePath,
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
 * Exported so that other bulk commands can reuse the same collection logic.
 */
export function collectFiles(
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
 *
 * @param frontmatterOverride  When provided, used instead of the metadata cache.
 *   Pass this when the cache may be stale (e.g. immediately after a
 *   processFrontMatter call whose cache update has not yet propagated).
 */
export async function reshelveFile(
    file: TFile,
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterOverride?: Record<string, unknown>
): Promise<boolean> {
    const frontmatter =
        frontmatterOverride ??
        await new FrontmatterService(app, settings, typeService).readFrontmatter(file);
    const typeField = typeService.getTypeFieldName();
    const context = { ...frontmatter, [typeField]: typeService.getPrimaryType(file, frontmatter) };
    const pathInfo = await computeExistingFilePath(file, settings, typeField, context);

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
