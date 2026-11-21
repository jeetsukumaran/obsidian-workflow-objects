import { App, Notice } from "obsidian";
import { NoteTypeAssignmentOptions, TypedNoteWorkflowsSettings } from "../types";
import { NoteTypeService } from "../services/NoteTypeService";
import { FrontmatterService } from "../services/FrontmatterService";
import { AssignNoteTypeModal } from "../modals/AssignNoteTypeModal";
import { getActiveFileWithMeta } from "../utils/helpers";
import { TypedNoteAssignmentDraft } from "../services/TypedNoteAssignmentDraft";
import { TypedNoteFieldsModal } from "../modals/TypedNoteFieldsModal";

/** Assign the active note to a chosen note type, with remembered metadata and location options. */
export async function assignNoteType(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService,
    frontmatterService: FrontmatterService,
    saveOptions: (options: NoteTypeAssignmentOptions) => Promise<void>
): Promise<void> {
    const active = getActiveFileWithMeta(app);
    if (!active) return;

    try {
        const noteTypeNames = noteTypeService.getAvailableNoteTypeNames();
        if (!noteTypeNames?.length) return;
        const currentNoteType = noteTypeService.getPrimaryNoteType(active.file, active.frontmatter);
        const rememberedNoteType = settings.typeAssignment.targetType;
        const targetType = noteTypeNames.includes(rememberedNoteType) ? rememberedNoteType
            : typeof currentNoteType === "string" && noteTypeNames.includes(currentNoteType) ? currentNoteType : noteTypeNames[0];
        const modal = new AssignNoteTypeModal(app, noteTypeNames, active.file.path, {
            ...settings.typeAssignment,
            targetType,
        });
        const options = await modal.openAndGetValue();
        if (!options) return;
        await saveOptions(options);

        const { file } = active;
        const draft = new TypedNoteAssignmentDraft(app, file, settings, noteTypeService, frontmatterService, options);
        await draft.initialize();
        const prepared = await new TypedNoteFieldsModal(app, draft, {
            title: "Edit fields for new note type", submitLabel: "Assign note type", locationOverrides: false,
        }).openAndSave();
        if (!prepared) return;
        new Notice(`Assigned to "${options.targetType}": added ${prepared.added}, removed ${prepared.removed}. ${file.path}`);
    } catch (error) {
        console.error("Typed Note Workflows: Error assigning note type", error);
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Could not assign note type: ${message}`);
    }
}
