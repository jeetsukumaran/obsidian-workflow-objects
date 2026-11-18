import { App, Notice } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { ObjectCreationService } from "../services/ObjectCreationService";
import { StringSuggesterModal } from "../modals/SuggesterModal";
import { ObjectFieldsModal } from "../modals/ObjectFieldsModal";
import { getSelection, openFile } from "../utils/helpers";

/** Select a schema, fill its typed draft, then create and open the object. */
export async function createNewWorkflowObject(app: App, settings: WorkflowObjectsSettings, typeService: TypeService): Promise<void> {
    try {
        const body = getSelection(app);
        const typeNames = typeService.getTypeNames();
        if (!typeNames) return;
        const selectedType = await new StringSuggesterModal(app, typeNames, "Create new workflow object of type").openAndGetValue();
        if (!selectedType) return;
        const schema = await typeService.getTypeFieldInfo(selectedType);
        if (!schema) throw new Error(`Schema unavailable: ${selectedType}`);
        const draft = new ObjectCreationService(app, settings, typeService, selectedType, schema, body);
        await draft.initialize();
        const file = await new ObjectFieldsModal(app, draft).openAndSave();
        if (!file) return;
        new Notice(`Created: ${file.path}`);
        await openFile(app, file);
    } catch (error) {
        console.error("Workflow Objects: Error creating workflow object", error);
        new Notice(`Error creating workflow object: ${error instanceof Error ? error.message : String(error)}`);
    }
}
