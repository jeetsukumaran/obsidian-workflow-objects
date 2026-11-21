import { App, Notice } from "obsidian";
import { TypedNoteWorkflowsSettings } from "../types";
import { NoteTypeService } from "../services/NoteTypeService";
import { TypedNoteCreationService } from "../services/TypedNoteCreationService";
import { StringSuggesterModal } from "../modals/SuggesterModal";
import { TypedNoteFieldsModal } from "../modals/TypedNoteFieldsModal";
import { getSelection, openFile } from "../utils/helpers";

/** Select a schema, fill its typed draft, then create and open the typed note. */
export async function createNewTypedNote(app: App, settings: TypedNoteWorkflowsSettings, noteTypeService: NoteTypeService): Promise<void> {
    try {
        const body = getSelection(app);
        const noteTypeNames = noteTypeService.getAvailableNoteTypeNames();
        if (!noteTypeNames) return;
        const selectedNoteType = await new StringSuggesterModal(app, noteTypeNames, "Create typed note — choose note type").openAndGetValue();
        if (!selectedNoteType) return;
        const schema = await noteTypeService.getNoteTypeFieldInfo(selectedNoteType);
        if (!schema) throw new Error(`Schema unavailable: ${selectedNoteType}`);
        const draft = new TypedNoteCreationService(app, settings, noteTypeService, selectedNoteType, schema, body);
        await draft.initialize();
        const file = await new TypedNoteFieldsModal(app, draft).openAndSave();
        if (!file) return;
        new Notice(`Created: ${file.path}`);
        await openFile(app, file);
    } catch (error) {
        console.error("Typed Note Workflows: Error creating typed note", error);
        new Notice(`Error creating typed note: ${error instanceof Error ? error.message : String(error)}`);
    }
}
