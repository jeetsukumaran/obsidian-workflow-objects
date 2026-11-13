import { App, Notice, normalizePath } from "obsidian";
import { TypeAssignmentOptions, WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { AssignObjectTypeModal } from "../modals/AssignObjectTypeModal";
import { getActiveFileWithMeta } from "../utils/helpers";
import { computeExistingFilePath, ensureFolderExists } from "../utils/pathUtils";

/** Assign the active object to a chosen type, with remembered metadata and location options. */
export async function assignObjectType(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    frontmatterService: FrontmatterService,
    saveOptions: (options: TypeAssignmentOptions) => Promise<void>
): Promise<void> {
    const active = getActiveFileWithMeta(app);
    if (!active) return;
    let metadataUpdated = false;

    try {
        const typeNames = typeService.getTypeNames();
        if (!typeNames?.length) return;
        const typeField = typeService.getTypeFieldName();
        const currentType = active.frontmatter[typeField];
        const rememberedType = settings.typeAssignment.targetType;
        const targetType = typeNames.includes(rememberedType) ? rememberedType
            : typeof currentType === "string" && typeNames.includes(currentType) ? currentType : typeNames[0];
        const modal = new AssignObjectTypeModal(app, typeNames, active.file.path, {
            ...settings.typeAssignment,
            targetType,
        });
        const options = await modal.openAndGetValue();
        if (!options) return;
        await saveOptions(options);

        const { file } = active;
        const prepared = await frontmatterService.prepareTypeAssignment(file, options);
        let destination = file.path;
        if (options.updateFileLocation && (options.autoRename || options.autoReshelve)) {
            // Retain the current title/date as naming inputs even if the chosen
            // metadata policy removes those fields from the new schema.
            const context = { ...prepared.original, ...prepared.frontmatter };
            const pathInfo = await computeExistingFilePath(
                file, settings, typeField, context, options.autoRename, options.autoReshelve
            );
            if (/[\\/]/.test(pathInfo.basename) || pathInfo.folder.split(/[\\/]/).includes("..")) {
                throw new Error("Path rules must produce a vault folder and a filename without folder separators");
            }
            destination = normalizePath(pathInfo.fullPath);
            if (destination !== file.path) {
                if (app.vault.getAbstractFileByPath(destination)) {
                    throw new Error(`Destination already exists: ${destination}`);
                }
                const folder = destination.slice(0, Math.max(0, destination.lastIndexOf("/")));
                await ensureFolderExists(app, folder);
            }
        }

        await frontmatterService.applyTypeAssignment(file, prepared);
        metadataUpdated = true;
        if (destination !== file.path) await app.fileManager.renameFile(file, destination);
        new Notice(`Assigned to "${options.targetType}": added ${prepared.added}, removed ${prepared.removed}. ${file.path}`);
    } catch (error) {
        console.error("Workflow Objects: Error assigning object type", error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(metadataUpdated
            ? `Type and metadata updated, but file location could not be changed: ${message}`
            : `Could not assign object type: ${message}`);
    }
}
