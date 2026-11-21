import { App, Notice, TFile } from "obsidian";
import { TypedNoteWorkflowsSettings } from "../types";
import { NoteTypeService } from "../services/NoteTypeService";
import { SuggesterModal, StringSuggesterModal } from "../modals";
import {
    getActiveFileWithMeta,
    openFile,
} from "../utils/helpers";

/**
 * Navigate to an adjacent typed note with the same note type
 * @param direction 1 for next, -1 for previous
 */
export async function navigate(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService,
    direction: 1 | -1
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    const { file, frontmatter } = result;
    const noteTypeValue = noteTypeService.getPrimaryNoteType(file, frontmatter);
    if (!noteTypeValue) { new Notice("No note type applies to this note"); return; }

    const matches = noteTypeService.getTypedNotesOfType(noteTypeValue)
        .sort((a, b) => settings.typedNoteSortDirection === "desc" ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path));
    const idx = matches.findIndex((f) => f.path === file.path);

    if (idx === -1) {
        new Notice("Current file not found in matches");
        return;
    }

    let target = idx + direction;

    if (target >= matches.length) {
        target = settings.wrapAround ? 0 : idx;
    } else if (target < 0) {
        target = settings.wrapAround ? matches.length - 1 : idx;
    }

    if (target !== idx) {
        await openFile(app, matches[target]);
        new Notice(`${target + 1}/${matches.length}`);
    } else {
        new Notice(`Only one typed note with note type "${noteTypeValue}"`);
    }
}

/**
 * Navigate to the next typed note
 */
export async function navigateNext(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService
): Promise<void> {
    return navigate(app, settings, noteTypeService, 1);
}

/**
 * Navigate to the previous typed note
 */
export async function navigatePrevious(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService
): Promise<void> {
    return navigate(app, settings, noteTypeService, -1);
}

/**
 * Open a typed note by note type selection, then file selection
 */
export async function openTypedNote(
    app: App,
    settings: TypedNoteWorkflowsSettings,
    noteTypeService: NoteTypeService
): Promise<void> {
    const noteTypeNames = noteTypeService.getAvailableNoteTypeNames();
    if (!noteTypeNames) return;

    const noteTypeField = noteTypeService.getNoteTypeFieldName();

    // Select note type
    const noteTypeSuggester = new StringSuggesterModal(
        app,
        noteTypeNames,
        "Open typed note — choose note type"
    );
    const selectedNoteType = await noteTypeSuggester.openAndGetValue();
    if (!selectedNoteType) return;

    // Get typed notes of that note type (sorted according to settings)
    const matchingFiles = noteTypeService.getTypedNotesOfType(selectedNoteType)
        .sort((a, b) => settings.typedNoteSortDirection === "desc" ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path));

    if (!matchingFiles.length) {
        new Notice(`No notes with ${noteTypeField}: "${selectedNoteType}"`);
        return;
    }

    // Create file suggester
    const fileSuggester = new SuggesterModal<TFile>(
        app,
        matchingFiles,
        (f) => f.path.replace(/\.md$/, ""),
        `${selectedNoteType} (${matchingFiles.length})`
    );

    const selectedFile = await fileSuggester.openAndGetValue();
    if (!selectedFile) return;

    await openFile(app, selectedFile);
}
