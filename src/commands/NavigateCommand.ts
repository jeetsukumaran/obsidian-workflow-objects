import { App, Notice, TFile } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { SuggesterModal, StringSuggesterModal } from "../modals";
import {
    getActiveFileWithMeta,
    openFile,
} from "../utils/helpers";

/**
 * Navigate to adjacent workflow object with same type
 * @param direction 1 for next, -1 for previous
 */
export async function navigate(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService,
    direction: 1 | -1
): Promise<void> {
    const result = getActiveFileWithMeta(app);
    if (!result) return;

    const { file, frontmatter } = result;
    const typeValue = typeService.getPrimaryType(file, frontmatter);
    if (!typeValue) { new Notice("No object type applies to this note"); return; }

    const matches = typeService.getFilesOfType(typeValue)
        .sort((a, b) => settings.objectSortDirection === "desc" ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path));
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
        new Notice(`Only 1 workflow object of type "${typeValue}"`);
    }
}

/**
 * Navigate to next workflow object
 */
export async function navigateNext(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    return navigate(app, settings, typeService, 1);
}

/**
 * Navigate to previous workflow object
 */
export async function navigatePrevious(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    return navigate(app, settings, typeService, -1);
}

/**
 * Open a workflow object by type selection, then file selection
 */
export async function openWorkflowObject(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    const typeNames = typeService.getTypeNames();
    if (!typeNames) return;

    const typeField = typeService.getTypeFieldName();

    // Select type
    const typeSuggester = new StringSuggesterModal(
        app,
        typeNames,
        "Open workflow object of type"
    );
    const selectedType = await typeSuggester.openAndGetValue();
    if (!selectedType) return;

    // Get files of that type (sorted according to settings)
    const matchingFiles = typeService.getFilesOfType(selectedType)
        .sort((a, b) => settings.objectSortDirection === "desc" ? b.path.localeCompare(a.path) : a.path.localeCompare(b.path));

    if (!matchingFiles.length) {
        new Notice(`No notes with ${typeField}: "${selectedType}"`);
        return;
    }

    // Create file suggester
    const fileSuggester = new SuggesterModal<TFile>(
        app,
        matchingFiles,
        (f) => f.path.replace(/\.md$/, ""),
        `${selectedType} (${matchingFiles.length})`
    );

    const selectedFile = await fileSuggester.openAndGetValue();
    if (!selectedFile) return;

    await openFile(app, selectedFile);
}
