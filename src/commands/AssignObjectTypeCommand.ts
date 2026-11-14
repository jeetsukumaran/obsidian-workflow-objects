import { App, Notice } from "obsidian";
import { TypeAssignmentOptions, WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { AssignObjectTypeModal } from "../modals/AssignObjectTypeModal";
import { getActiveFileWithMeta } from "../utils/helpers";
import { ObjectUpdateService } from "../services/ObjectUpdateService";

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

    try {
        const typeNames = typeService.getTypeNames();
        if (!typeNames?.length) return;
        const currentType = typeService.getPrimaryType(active.file, active.frontmatter);
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
        const prepared = await new ObjectUpdateService(app, settings, typeService, frontmatterService).assignType(file, options);
        if (!prepared) return;
        new Notice(`Assigned to "${options.targetType}": added ${prepared.added}, removed ${prepared.removed}. ${file.path}`);
    } catch (error) {
        console.error("Workflow Objects: Error assigning object type", error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Could not assign object type: ${message}`);
    }
}
