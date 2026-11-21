import { App, Notice } from "obsidian";
import { TypedNoteWorkflowsSettings, NoteTypeAssignmentOptions } from "../types";
import { NoteTypeService } from "../services/NoteTypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { BulkAssignNoteTypeModal } from "../modals/BulkAssignNoteTypeModal";
import {
    BulkAssignPreviewModal,
    FilePreviewEntry,
} from "../modals/BulkAssignPreviewModal";
import { TypedNoteUpdateService } from "../services/TypedNoteUpdateService";
import { collectFiles } from "./VaultCurationCommand";

/** Preview a scoped set of notes, then apply the same assignment policy as the single-note command. */
export async function bulkAssignNoteType(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    // ── Step 1: type names ────────────────────────────────────────────────────
    const noteTypeNames = noteTypeService.getAvailableNoteTypeNames();
    if (!noteTypeNames || noteTypeNames.length === 0) return;

    // ── Step 2: configuration modal ───────────────────────────────────────────
    const configModal = new BulkAssignNoteTypeModal(app, settings, noteTypeNames);
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
    const noteTypeField = noteTypeService.getNoteTypeFieldName();
    const entries: FilePreviewEntry[] = files.map((file) => {
        const fm =
            app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const currentNoteType = fm[noteTypeField] as string | undefined;
        return { file, currentNoteType };
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
        `Assigning note type "${opts.targetType}" to ` +
            `${previewResult.selectedFiles.length} file(s)…`
    );

    const totals = { assigned: 0, cleaned: 0, sorted: 0, reshelved: 0, skipped: 0, errors: 0 };

    const options: NoteTypeAssignmentOptions = {
        targetType: opts.targetType,
        updateFileLocation: opts.runReshelve,
        autoRename: true,
        autoReshelve: true,
        addMissingFields: opts.runClean,
        removeFields: opts.runClean ? opts.cleanMode === "strict" ? "all" : "empty" : "never",
        sortMode: opts.runSort ? opts.sortMode : "none",
        newFieldsPosition: "append",
    };
    const typedNoteUpdates = new TypedNoteUpdateService(app, settings, noteTypeService, frontmatterService);
    for (const file of previewResult.selectedFiles) {
        try {
            const result = await typedNoteUpdates.assignNoteType(file, options);
            if (!result) { totals.skipped++; continue; }
            totals.assigned++;
            if (opts.runClean) totals.cleaned++;
            if (opts.runSort) totals.sorted++;
            if (result.moved) totals.reshelved++;
        } catch (err) {
            console.error(`[bulk-assign-note-type] Error on ${file.path}:`, err);
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
    skipped: number;
    errors: number;
}): string {
    const parts: string[] = [
        `Assigned note type to ${totals.assigned} file(s)`,
    ];
    if (totals.cleaned) parts.push(`cleaned ${totals.cleaned}`);
    if (totals.sorted && !totals.cleaned) parts.push(`sorted ${totals.sorted}`);
    if (totals.reshelved) parts.push(`reshelved ${totals.reshelved}`);
    if (totals.skipped) parts.push(`skipped ${totals.skipped}`);
    if (totals.errors)
        parts.push(`${totals.errors} error(s) — see console`);
    return parts.join(" · ");
}
