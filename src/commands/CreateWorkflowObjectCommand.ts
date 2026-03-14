import { App, Notice } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { StringSuggesterModal, InputModal } from "../modals";
import {
    getSelection,
    openFile,
    formatYamlValue,
    getDefaultValueForType,
    sortEntries,
} from "../utils/helpers";
import {
    computeFilePath,
    ensureFolderExists,
} from "../utils/pathUtils";

/**
 * Create a new workflow workflow object with metadata from type definition
 */
export async function createNewWorkflowObject(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    try {
        // Get available types
        const typeNames = typeService.getTypeNames();
        if (!typeNames) return;

        // Select type
        const typeSuggester = new StringSuggesterModal(
            app,
            typeNames,
            "Create new workflow object of type"
        );
        const selectedType = await typeSuggester.openAndGetValue();
        if (!selectedType) return;

        // Get title
        const inputModal = new InputModal(app, "Title", selectedType, selectedType);
        const title = await inputModal.openAndGetValue();
        if (!title) return;

        // Get field definitions and sort order
        const fields = typeService.getTypeFieldDefinitions(selectedType);
        const fieldOrder = typeService.getFieldSortOrder(selectedType);
        const entries: [string, unknown][] = [];

        // Add content-type field
        entries.push([typeService.getTypeFieldName(), selectedType]);

        if (fields && Array.isArray(fields)) {
            for (const field of fields) {
                const name = field.name;
                if (name === settings.fields.title) continue; // Handle title separately

                const defaultValue = getDefaultValueForType(
                    field.type,
                    field.options || {},
                    settings.dateFormat
                );
                entries.push([name, defaultValue]);
            }
        }

        // Add title — formatYamlValue (called below) handles all quoting
        entries.push([settings.fields.title, title]);

        // Sort according to settings
        const sortedEntries = sortEntries(entries, fieldOrder, settings.defaultFieldSort);

        const yamlLines = sortedEntries.map(([key, value]) =>
            `${key}: ${formatYamlValue(value)}`
        );

        const selected = getSelection(app);
        const content = `---\n${yamlLines.join("\n")}\n---\n${selected}`;

        // Build frontmatter context for template expansion
        const frontmatterCtx: Record<string, unknown> = Object.fromEntries(entries);
        frontmatterCtx[settings.fields.title] = title;

        // Compute file path using shared logic (new file, so no existing prefix or ctime)
        const pathInfo = await computeFilePath(
            settings,
            selectedType,
            title,
            null,
            undefined,
            frontmatterCtx
        );

        // Check if file exists
        const existingFile = app.vault.getAbstractFileByPath(pathInfo.fullPath);
        if (existingFile) {
            new Notice(`File already exists: ${pathInfo.fullPath}`);
            return;
        }

        // Create folder if needed
        await ensureFolderExists(app, pathInfo.folder);

        // Create and open file
        const file = await app.vault.create(pathInfo.fullPath, content);
        await openFile(app, file);
        new Notice(`Created: ${pathInfo.fullPath}`);
    } catch (error) {
        console.error("Workflow Objects: Error creating workflow object", error);
        new Notice(`Error creating workflow object: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Create a new workflow object with minimal frontmatter (no type definition)
 */
export async function createNewWorkflowObjectSimple(
    app: App,
    settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    try {
        // Get available types
        const typeNames = typeService.getTypeNames();
        if (!typeNames) return;

        // Select type
        const typeSuggester = new StringSuggesterModal(
            app,
            typeNames,
            "Create new workflow object of type"
        );
        const selectedType = await typeSuggester.openAndGetValue();
        if (!selectedType) return;

        // Get title
        const inputModal = new InputModal(app, "Title", selectedType, selectedType);
        const title = await inputModal.openAndGetValue();
        if (!title) return;

        const selected = getSelection(app);
        const content = `---
${settings.fields.title}: ${formatYamlValue(title)}
${typeService.getTypeFieldName()}: ${selectedType}
---
${selected}`;

        // Compute file path using shared logic
        const pathInfo = await computeFilePath(
            settings,
            selectedType,
            title,
            null,
            undefined,
            { [settings.fields.title]: title, [typeService.getTypeFieldName()]: selectedType }
        );

        // Check if file exists
        const existingFile = app.vault.getAbstractFileByPath(pathInfo.fullPath);
        if (existingFile) {
            new Notice(`File already exists: ${pathInfo.fullPath}`);
            return;
        }

        // Create folder if needed
        await ensureFolderExists(app, pathInfo.folder);

        // Create and open file
        const file = await app.vault.create(pathInfo.fullPath, content);
        await openFile(app, file);
        new Notice(`Created: ${pathInfo.fullPath}`);
    } catch (error) {
        console.error("Workflow Objects: Error creating workflow object", error);
        new Notice(`Error creating workflow object: ${error instanceof Error ? error.message : String(error)}`);
    }
}
