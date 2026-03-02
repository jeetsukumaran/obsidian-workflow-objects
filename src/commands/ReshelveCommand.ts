import { App, Notice } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { getActiveFileWithMeta } from "../utils/helpers";
import { reshelveFile } from "./VaultCurationCommand";

/**
 * Move/rename the active file based on its content-type and title metadata.
 * Delegates core logic to the shared `reshelveFile` helper so that the same
 * behaviour is used by both the single-file and vault-wide commands.
 */
export async function reshelveWorkflowObject(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    const moved = await reshelveFile(result.file, app, settings, typeService);
    if (moved) {
        // The file has already been renamed; its new path is reflected on the
        // TFile object after the rename, but Notice text is handled here for
        // the interactive case.
        new Notice(`Moved to new location`);
    } else {
        new Notice("Already in correct location");
    }
}
