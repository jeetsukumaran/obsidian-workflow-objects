import { App, Notice } from "obsidian";
import { TypedNoteWorkflowsSettings } from "../types";
import { NoteTypeService } from "../services/NoteTypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { TypedNoteUpdateService } from "../services/TypedNoteUpdateService";
import { getActiveFileWithMeta } from "../utils/helpers";

/**
 * Move/rename the active file based on its note type and title metadata.
 * TypedNoteUpdateService also implements relocation for curation and reassignment.
 */
export async function reshelveTypedNote(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    try {
        const updated = await new TypedNoteUpdateService(app, settings, noteTypeService, frontmatterService).reshelve(result.file);
        if (!updated) return;
        new Notice(updated.moved ? "Moved to new location" : "Already in correct location");
    } catch (error) {
        console.error("[reshelve-typed-note]", error);
        new Notice(`Could not reshelve: ${error instanceof Error ? error.message : String(error)}`);
    }
}
