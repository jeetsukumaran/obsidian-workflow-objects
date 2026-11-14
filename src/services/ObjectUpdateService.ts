import { App, TFile, normalizePath } from "obsidian";
import { TypeAssignmentOptions, WorkflowObjectsSettings } from "../types";
import { InputModal } from "../modals/InputModal";
import { FrontmatterService, PreparedFrontmatterEdit } from "./FrontmatterService";
import { TypeService } from "./TypeService";
import { computeExistingFilePath, ensureFolderExists } from "../utils/pathUtils";

interface LocationOptions {
    autoRename: boolean;
    autoReshelve: boolean;
}

interface ObjectUpdateResult extends PreparedFrontmatterEdit {
    moved: boolean;
}

type PrepareMetadata = (
    destination: string, original: Record<string, unknown>, suppliedTitle?: string
) => Promise<PreparedFrontmatterEdit>;

/** Updates existing objects; every command shares title prompting and relocation. */
export class ObjectUpdateService {
    constructor(
        private app: App, private settings: WorkflowObjectsSettings,
        private types: TypeService, private metadata: FrontmatterService
    ) {}

    /** Preserve metadata while applying the current type's filename and folder rules. */
    reshelve(file: TFile): Promise<ObjectUpdateResult | null> {
        return this.update(file, { autoRename: true, autoReshelve: true }, async (_destination, original, suppliedTitle) => ({
            sourcePath: file.path,
            original,
            frontmatter: suppliedTitle === undefined ? original : { ...original, [this.settings.fields.title]: suppliedTitle },
            added: suppliedTitle !== undefined && !Object.prototype.hasOwnProperty.call(original, this.settings.fields.title) ? 1 : 0,
            removed: 0,
            schemaSignature: this.types.schemaSignature(file),
        }));
    }

    /** Reconcile the destination schema and relocate using the same operation as reshelving. */
    assignType(file: TFile, options: TypeAssignmentOptions): Promise<ObjectUpdateResult | null> {
        return this.update(file, {
            autoRename: options.updateFileLocation && options.autoRename,
            autoReshelve: options.updateFileLocation && options.autoReshelve,
        }, (destination, original, suppliedTitle) =>
            this.metadata.prepareTypeAssignment(file, options, destination, original, suppliedTitle));
    }

    /** Return null on title cancellation, before modifying the note or creating folders. */
    private async update(file: TFile, location: LocationOptions, prepare: PrepareMetadata): Promise<ObjectUpdateResult | null> {
        const sourcePath = file.path;
        const original = await this.metadata.readFrontmatter(file);
        // Validate assignment schemas before asking for input.
        let prepared = await prepare(sourcePath, original);
        let suppliedTitle: string | undefined;
        const currentTitle = original[this.settings.fields.title];
        if (location.autoRename && (currentTitle == null || (typeof currentTitle === "string" && !currentTitle.trim()))) {
            const title = await new InputModal(this.app, `Title for ${file.name}`, "Enter a title", file.basename).openAndGetValue();
            if (title === null) return null;
            suppliedTitle = title;
            prepared = await prepare(sourcePath, original, suppliedTitle);
        }

        let destination = sourcePath;
        if (location.autoRename || location.autoReshelve) {
            // Naming may use existing values even if the metadata policy removes them.
            const context = { ...original, ...prepared.frontmatter };
            const typeField = this.types.getTypeFieldName();
            const path = await computeExistingFilePath(file, this.settings, typeField,
                { ...context, [typeField]: this.types.getPrimaryType(file, context) },
                location.autoRename, location.autoReshelve);
            if (/[\\/]/.test(path.basename) || path.folder.split(/[\\/]/).includes("..")) {
                throw new Error("Path rules must produce a vault folder and a filename without folder separators");
            }
            destination = normalizePath(path.fullPath);
            if (destination !== sourcePath) {
                prepared = await prepare(destination, original, suppliedTitle);
                if (this.app.vault.getAbstractFileByPath(destination)) throw new Error(`Destination already exists: ${destination}`);
                await ensureFolderExists(this.app, destination.slice(0, Math.max(0, destination.lastIndexOf("/"))));
            }
        }
        await this.metadata.assertPreparedEditCurrent(file, { ...prepared, sourcePath });
        const moved = destination !== sourcePath;
        if (moved) await this.app.fileManager.renameFile(file, destination);
        try {
            // A failed move cannot change metadata. A failed metadata write rolls
            // the move back. Pure reshelving does not rewrite unchanged metadata.
            if (JSON.stringify(prepared.frontmatter) !== JSON.stringify(original)) {
                await this.metadata.applyPreparedEdit(file, { ...prepared, sourcePath: destination });
            }
        } catch (error) {
            if (moved) {
                try {
                    if (file.path !== destination || this.app.vault.getAbstractFileByPath(sourcePath)) {
                        throw new Error("Original path is no longer available");
                    }
                    await this.app.fileManager.renameFile(file, sourcePath);
                } catch {
                    throw new Error(`Metadata update failed; the file remains at ${file.path}. ${String(error)}`);
                }
            }
            throw error;
        }
        return { ...prepared, moved };
    }
}
