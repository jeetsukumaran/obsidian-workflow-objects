import { App, TFile, normalizePath } from "obsidian";
import { NoteTypeAssignmentOptions, TypedNoteWorkflowsSettings } from "../types";
import { InputModal } from "../modals/InputModal";
import { FrontmatterService, PreparedFrontmatterEdit } from "./FrontmatterService";
import { NoteTypeService } from "./NoteTypeService";
import { computeExistingFilePath, ensureFolderExists, FilePathInfo } from "../utils/pathUtils";

interface LocationOptions {
    autoRename: boolean;
    autoReshelve: boolean;
}

export interface TypedNoteUpdateResult extends PreparedFrontmatterEdit {
    moved: boolean;
}

export interface PlannedTypedNoteUpdate extends PreparedFrontmatterEdit { path: FilePathInfo }

type PrepareMetadata = (
    destination: string, original: Record<string, unknown>, suppliedTitle?: string
) => Promise<PreparedFrontmatterEdit>;

/** Updates existing typed notes; every command shares title prompting and relocation. */
export class TypedNoteUpdateService {
    constructor(
        private app: App, private settings: TypedNoteWorkflowsSettings,
        private noteTypes: NoteTypeService, private metadata: FrontmatterService
    ) {}

    /** Preserve metadata while applying the current note type's filename and folder rules. */
    reshelve(file: TFile): Promise<TypedNoteUpdateResult | null> {
        return this.update(file, { autoRename: true, autoReshelve: true }, async (_destination, original, suppliedTitle) => ({
            sourcePath: file.path,
            original,
            frontmatter: suppliedTitle === undefined ? original : { ...original, [this.settings.fields.title]: suppliedTitle },
            added: suppliedTitle !== undefined && !Object.prototype.hasOwnProperty.call(original, this.settings.fields.title) ? 1 : 0,
            removed: 0,
            schemaSignature: this.noteTypes.schemaSignature(file),
        }));
    }

    /** Reconcile the destination schema and relocate using the same operation as reshelving. */
    assignNoteType(file: TFile, options: NoteTypeAssignmentOptions): Promise<TypedNoteUpdateResult | null> {
        return this.update(file, {
            autoRename: options.updateFileLocation && options.autoRename,
            autoReshelve: options.updateFileLocation && options.autoReshelve,
        }, (destination, original, suppliedTitle) =>
            this.metadata.prepareNoteTypeAssignment(file, options, destination, original, suppliedTitle));
    }

    /** The interactive editor supplies values; relocation and metadata policy stay here. */
    planAssignment(file: TFile, options: NoteTypeAssignmentOptions, original: Record<string, unknown>,
        edits: (destination: string) => Record<string, unknown>): Promise<PlannedTypedNoteUpdate> {
        return this.plan(file, original, {
            autoRename: options.updateFileLocation && options.autoRename,
            autoReshelve: options.updateFileLocation && options.autoReshelve,
        }, destination => this.metadata.prepareNoteTypeAssignment(file, options, destination, original, undefined, edits(destination)));
    }

    /** Return null on title cancellation, before modifying the note or creating folders. */
    private async update(file: TFile, location: LocationOptions, prepare: PrepareMetadata): Promise<TypedNoteUpdateResult | null> {
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

        const plan = await this.plan(file, original, location, destination => prepare(destination, original, suppliedTitle), prepared);
        return this.apply(file, plan);
    }

    private async plan(file: TFile, original: Record<string, unknown>, location: LocationOptions,
        prepare: (destination: string) => Promise<PreparedFrontmatterEdit>, initial?: PreparedFrontmatterEdit): Promise<PlannedTypedNoteUpdate> {
        let destination = file.path;
        let prepared = initial ?? await prepare(destination);
        for (let attempt = 0; attempt < 5; attempt++) {
            // Naming may use existing values even if the metadata policy removes them.
            const context = { ...original, ...prepared.frontmatter };
            const noteTypeField = this.noteTypes.getNoteTypeFieldName();
            const path = await computeExistingFilePath(file, this.settings, noteTypeField,
                { ...context, [noteTypeField]: this.noteTypes.getPrimaryNoteType(file, context) },
                location.autoRename, location.autoReshelve);
            if (/[\\/]/.test(path.basename) || path.folder.split(/[\\/]/).includes("..")) {
                throw new Error("Path rules must produce a vault folder and a filename without folder separators");
            }
            path.fullPath = normalizePath(path.fullPath);
            if (path.fullPath === destination) return { ...prepared, path };
            destination = path.fullPath;
            prepared = await prepare(destination);
        }
        throw new Error("The destination rules and contextual schemas do not produce a stable location.");
    }

    /** Both interactive and bulk edits use this guarded move/write/rollback operation. */
    async apply(file: TFile, plan: PlannedTypedNoteUpdate): Promise<TypedNoteUpdateResult> {
        const { sourcePath, original, path, ...prepared } = plan;
        const destination = path.fullPath;
        await this.metadata.assertPreparedEditCurrent(file, plan);
        const moved = destination !== sourcePath;
        if (moved) {
            if (this.app.vault.getAbstractFileByPath(destination)) throw new Error(`Destination already exists: ${destination}`);
            await ensureFolderExists(this.app, destination.slice(0, Math.max(0, destination.lastIndexOf("/"))));
            await this.metadata.assertPreparedEditCurrent(file, plan);
        }
        if (moved) await this.app.fileManager.renameFile(file, destination);
        try {
            // A failed move cannot change metadata. A failed metadata write rolls
            // the move back. Pure reshelving does not rewrite unchanged metadata.
            if (JSON.stringify(prepared.frontmatter) !== JSON.stringify(original)) {
                await this.metadata.applyPreparedEdit(file, { ...prepared, original, sourcePath: destination });
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
        return { ...prepared, original, sourcePath, moved };
    }
}
