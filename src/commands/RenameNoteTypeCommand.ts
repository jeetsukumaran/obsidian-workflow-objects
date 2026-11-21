import { App, Notice, TFile } from "obsidian";
import { TypedNoteWorkflowsSettings } from "../types";
import { FrontmatterService } from "../services/FrontmatterService";
import { NoteTypeService } from "../services/NoteTypeService";
import { NoteTypeRenameService } from "../services/NoteTypeRenameService";
import { RenameNoteTypeModal } from "../modals/RenameNoteTypeModal";

export async function renameNoteType(
    app: App, settings: TypedNoteWorkflowsSettings, noteTypes: NoteTypeService,
    metadata: FrontmatterService, saveSettings: () => Promise<void>, selectedFile?: TFile,
): Promise<void> {
    try {
        noteTypes.getSchemaProviderForEdits();
        const names = noteTypes.getAvailableNoteTypeNames();
        if (!names?.length) return;
        const file = selectedFile ?? app.workspace.getActiveFile();
        const initial = file && noteTypes.isNoteTypeDefinitionFile(file)
            ? names.find(name => noteTypes.getNoteTypeFile(name) === file)
            : file ? noteTypes.getPrimaryNoteType(file, await metadata.readFrontmatter(file)) : undefined;
        await new RenameNoteTypeModal(app, names, initial && names.includes(initial) ? initial : names[0],
            new NoteTypeRenameService(app, settings, noteTypes, metadata, saveSettings)).openAndWait();
    } catch (error) {
        new Notice(`Cannot rename note type: ${error instanceof Error ? error.message : String(error)}`);
    }
}
