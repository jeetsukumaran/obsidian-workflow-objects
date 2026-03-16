import { App, Notice } from "obsidian";
import {
    WorkflowObjectsSettings,
    CleanupOptions,
    DEFAULT_CLEANUP_OPTIONS,
} from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { BulkAssignTypeModal } from "../modals/BulkAssignTypeModal";
import {
    BulkAssignPreviewModal,
    FilePreviewEntry,
} from "../modals/BulkAssignPreviewModal";
import { collectFiles, reshelveFile } from "./VaultCurationCommand";

/**
 * "Bulk assign object type" command.
 *
 * Flow:
 *  1. Load available type names — abort if none found.
 *  2. Show {@link BulkAssignTypeModal}: user picks the target type, scopes the
 *     file set with a directory + optional include/exclude regexes, and opts
 *     into post-assign clean / sort operations.
 *  3. Collect matching `.md` / `.qmd` files using the shared `collectFiles`
 *     helper from VaultCurationCommand.
 *  4. Show {@link BulkAssignPreviewModal}: user sees every matched file (with
 *     its current type, if any) and can deselect individual entries before
 *     committing.
 *  5. For each confirmed file:
 *     a. Write the target type into the type field via `processFrontMatter`.
 *     b. Optionally clean frontmatter (standard or strict) against the new
 *        type's schema, folding any requested sort into the same pass to
 *        avoid redundant file writes.
 *     c. If sort was requested but clean was not, run a sort-only clean pass
 *        (preserveDefinedFields=true, no add/remove) so that the sort
 *        operates against the freshly assigned schema without firing
 *        individual per-file sort Notices.
 *     d. Optionally reshelve: delegate to `reshelveFile` (the same helper
 *        used by ReshelveCommand and curateVault) so the file is moved/renamed
 *        to match its new type and title.
 *  6. Display a summary Notice.
 */
export async function bulkAssignType(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    // ── Step 1: type names ────────────────────────────────────────────────────
    const typeNames = typeService.getTypeNames();
    if (!typeNames || typeNames.length === 0) return;

    // ── Step 2: configuration modal ───────────────────────────────────────────
    const configModal = new BulkAssignTypeModal(app, settings, typeNames);
    const opts = await configModal.openAndGetValue();
    if (!opts) return;

    // Validate regexes before touching any files
    let includeRe: RegExp | null = null;
    let excludeRe: RegExp | null = null;
    try {
        if (opts.includePattern) includeRe = new RegExp(opts.includePattern);
        if (opts.excludePattern) excludeRe = new RegExp(opts.excludePattern);
    } catch {
        new Notice("Invalid regex pattern — aborting");
        return;
    }

    // ── Step 3: collect files ─────────────────────────────────────────────────
    const files = collectFiles(
        app,
        opts.directory,
        opts.recursive,
        includeRe,
        excludeRe
    );
    if (files.length === 0) {
        new Notice("No files matched the given scope and filters");
        return;
    }

    // ── Step 4: build preview entries ─────────────────────────────────────────
    const typeField = typeService.getTypeFieldName();
    const entries: FilePreviewEntry[] = files.map((file) => {
        const fm =
            app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const currentType = fm[typeField] as string | undefined;
        return { file, currentType };
    });

    // ── Step 5: preview / selection modal ─────────────────────────────────────
    const previewModal = new BulkAssignPreviewModal(
        app,
        entries,
        opts.targetType
    );
    const previewResult = await previewModal.openAndGetValue();
    if (!previewResult || previewResult.selectedFiles.length === 0) return;

    // ── Step 6: execute ───────────────────────────────────────────────────────
    new Notice(
        `Assigning type "${opts.targetType}" to ` +
            `${previewResult.selectedFiles.length} file(s)…`
    );

    const totals = { assigned: 0, cleaned: 0, sorted: 0, reshelved: 0, errors: 0 };

    // Build the CleanupOptions once — sort is folded in so we avoid a second
    // processFrontMatter call when both clean and sort are requested.
    const effectiveSortMode = opts.runSort ? opts.sortMode : "none";

    const cleanOptions: CleanupOptions | null = opts.runClean
        ? opts.cleanMode === "strict"
            ? {
                  preserveDefinedFields: true,
                  removeUndefinedFields: true,
                  addMissingFields: true,
                  sortMode: effectiveSortMode,
              }
            : {
                  ...DEFAULT_CLEANUP_OPTIONS,
                  sortMode: effectiveSortMode,
              }
        : null;

    // Sort-only options: used when clean is disabled but sort is requested.
    const sortOnlyOptions: CleanupOptions = {
        preserveDefinedFields: true,
        removeUndefinedFields: false,
        addMissingFields: false,
        sortMode: opts.sortMode,
    };

    for (const file of previewResult.selectedFiles) {
        try {
            // Assign type field
            await app.fileManager.processFrontMatter(
                file,
                (fm: Record<string, unknown>) => {
                    fm[typeField] = opts.targetType;
                }
            );
            totals.assigned++;

            if (cleanOptions) {
                // Clean (with sort folded in if requested)
                await frontmatterService.cleanFrontmatter(file, cleanOptions);
                totals.cleaned++;
                if (opts.runSort) totals.sorted++;
            } else if (opts.runSort) {
                // Sort only — use cleanFrontmatter with a no-op clean config
                // so we operate against the freshly assigned schema without
                // firing individual per-file Notices.
                await frontmatterService.cleanFrontmatter(
                    file,
                    sortOnlyOptions
                );
                totals.sorted++;
            }

            if (opts.runReshelve) {
                // reshelveFile re-reads the file's frontmatter from the
                // metadata cache, which will reflect the type we just wrote.
                const moved = await reshelveFile(
                    file,
                    app,
                    settings,
                    typeService
                );
                if (moved) totals.reshelved++;
            }
        } catch (err) {
            console.error(`[bulk-assign-type] Error on ${file.path}:`, err);
            totals.errors++;
        }
    }

    new Notice(buildSummary(totals));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSummary(totals: {
    assigned: number;
    cleaned: number;
    sorted: number;
    reshelved: number;
    errors: number;
}): string {
    const parts: string[] = [
        `Assigned type to ${totals.assigned} file(s)`,
    ];
    if (totals.cleaned) parts.push(`cleaned ${totals.cleaned}`);
    if (totals.sorted && !totals.cleaned) parts.push(`sorted ${totals.sorted}`);
    if (totals.reshelved) parts.push(`reshelved ${totals.reshelved}`);
    if (totals.errors)
        parts.push(`${totals.errors} error(s) — see console`);
    return parts.join(" · ");
}
