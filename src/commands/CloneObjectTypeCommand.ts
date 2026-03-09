import { App, Notice, TFile } from "obsidian";
import { WorkflowObjectsSettings } from "../types";
import { TypeService } from "../services/TypeService";
import { StringSuggesterModal } from "../modals/SuggesterModal";
import { CloneObjectTypeModal } from "../modals/CloneObjectTypeModal";
import { ensureFolderExists } from "../utils/pathUtils";

/**
 * "Clone object type" command.
 *
 * Flow:
 *  1. Suggest-modal: pick the source object type to clone from.
 *  2. Clone modal: set a name, select / rename / reorder fields.
 *  3. Create the new fileClass `.md` file and populate its frontmatter via
 *     Obsidian's `processFrontMatter` — the same mechanism Metadata Menu
 *     itself uses to write fileClass definitions.
 *
 * The Metadata Menu public API (`MetadataMenu.api`) is used where it covers
 * the required functionality (field-value operations).  Cloning a fileClass
 * definition is not part of that API, so we write the file directly.
 */
export async function cloneObjectType(
    app: App,
    _settings: WorkflowObjectsSettings,
    typeService: TypeService
): Promise<void> {
    try {
        // ── Step 1: choose source type ─────────────────────────────────────
        const typeNames = typeService.getTypeNames();
        if (!typeNames || typeNames.length === 0) return;

        const suggester = new StringSuggesterModal(
            app,
            typeNames,
            "Clone object type — choose source"
        );
        const sourceName = await suggester.openAndGetValue();
        if (!sourceName) return;

        const sourceFields = typeService.getTypeFieldDefinitions(sourceName);
        if (!sourceFields || sourceFields.length === 0) {
            new Notice(`"${sourceName}" has no field definitions to clone.`);
            return;
        }

        // ── Step 2: show clone modal ───────────────────────────────────────
        const modal = new CloneObjectTypeModal(
            app,
            sourceName,
            sourceFields,
            typeNames
        );
        const result = await modal.openAndGetValue();
        if (!result) return;

        // ── Step 3: create the new fileClass file ─────────────────────────
        const typesPath = typeService.getTypesPath();
        const newFilePath = `${typesPath}/${result.newName}.md`;

        // Guard against race-condition or stale existingNames list
        const alreadyExists = app.vault.getAbstractFileByPath(newFilePath);
        if (alreadyExists) {
            new Notice(`File already exists: ${newFilePath}`);
            return;
        }

        await ensureFolderExists(app, typesPath);

        // Create the file with empty frontmatter; MM convention is "---\n---"
        const newFile = await app.vault.create(newFilePath, "---\n---\n");

        // Write field definitions via Obsidian's processFrontMatter —
        // the same mechanism Metadata Menu uses internally.
        await app.fileManager.processFrontMatter(newFile, (fm: Record<string, unknown>) => {
            fm["fields"] = result.fields;
            fm["fieldsOrder"] = result.fieldsOrder;
        });

        new Notice(`Cloned "${sourceName}" → "${result.newName}"`);

        // Open the new fileClass definition for inspection
        const leaf = app.workspace.getLeaf(false);
        const createdFile = app.vault.getAbstractFileByPath(newFilePath);
        if (leaf && createdFile instanceof TFile) {
            await leaf.openFile(createdFile);
        }
    } catch (error) {
        console.error("Workflow Objects: Error cloning object type", error);
        new Notice(
            `Error cloning object type: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
