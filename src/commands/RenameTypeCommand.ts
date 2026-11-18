import { App, Notice, TFile } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { FrontmatterService } from "../services/FrontmatterService";
import { TypeService } from "../services/TypeService";
import { TypeRenameService } from "../services/TypeRenameService";
import { RenameTypeModal } from "../modals/RenameTypeModal";

export async function renameType(
    app: App, settings: WorkflowObjectsSettings, types: TypeService,
    metadata: FrontmatterService, saveSettings: () => Promise<void>, selectedFile?: TFile,
): Promise<void> {
    try {
        types.getSchemaProviderForEdits();
        const names = types.getTypeNames();
        if (!names?.length) return;
        const file = selectedFile ?? app.workspace.getActiveFile();
        const initial = file && types.isTypeDefinitionFile(file)
            ? names.find(name => types.getTypeFile(name) === file)
            : file ? types.getPrimaryType(file, await metadata.readFrontmatter(file)) : undefined;
        await new RenameTypeModal(app, names, initial && names.includes(initial) ? initial : names[0],
            new TypeRenameService(app, settings, types, metadata, saveSettings)).openAndWait();
    } catch (error) {
        new Notice(`Cannot rename type: ${error instanceof Error ? error.message : String(error)}`);
    }
}
