import { App, Notice } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { ObjectUpdateService } from "../services/ObjectUpdateService";
import { getActiveFileWithMeta } from "../utils/helpers";

/**
 * Move/rename the active file based on its content-type and title metadata.
 * ObjectUpdateService also implements relocation for curation and reassignment.
 */
export async function reshelveWorkflowObject(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    try {
        const updated = await new ObjectUpdateService(app, settings, typeService, frontmatterService).reshelve(result.file);
        if (!updated) return;
        new Notice(updated.moved ? "Moved to new location" : "Already in correct location");
    } catch (error) {
        console.error("[reshelve-workflow-object]", error);
        new Notice(`Could not reshelve: ${error instanceof Error ? error.message : String(error)}`);
    }
}
