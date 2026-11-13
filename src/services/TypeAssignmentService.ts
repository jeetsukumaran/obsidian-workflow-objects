import { App, TFile, normalizePath } from "obsidian";
import { TypeAssignmentOptions, WorkflowObjectsSettings } from "../types";
import { FrontmatterService, PreparedTypeAssignment } from "./FrontmatterService";
import { TypeService } from "./TypeService";
import { computeExistingFilePath, ensureFolderExists } from "../utils/pathUtils";

/** Single and bulk assignment share destination planning and failure handling. */
export class TypeAssignmentService {
    constructor(
        private app: App, private settings: WorkflowObjectsSettings,
        private types: TypeService, private metadata: FrontmatterService
    ) {}

    async assign(file: TFile, options: TypeAssignmentOptions): Promise<PreparedTypeAssignment & { moved: boolean }> {
        const sourcePath = file.path;
        const original = await this.metadata.readFrontmatter(file);
        // Naming can use old values even when the final metadata policy removes them.
        let prepared = await this.metadata.prepareTypeAssignment(file, options, sourcePath, original);
        let destination = sourcePath;
        if (options.updateFileLocation && (options.autoRename || options.autoReshelve)) {
            const context = { ...original, ...prepared.frontmatter };
            const path = await computeExistingFilePath(file, this.settings, this.types.getTypeFieldName(), context,
                options.autoRename, options.autoReshelve);
            if (/[\\/]/.test(path.basename) || path.folder.split(/[\\/]/).includes("..")) {
                throw new Error("Path rules must produce a vault folder and a filename without folder separators");
            }
            destination = normalizePath(path.fullPath);
            if (destination !== sourcePath) {
                prepared = await this.metadata.prepareTypeAssignment(file, options, destination, original);
                if (this.app.vault.getAbstractFileByPath(destination)) throw new Error(`Destination already exists: ${destination}`);
                await ensureFolderExists(this.app, destination.slice(0, Math.max(0, destination.lastIndexOf("/"))));
            }
        }
        if (file.path !== sourcePath) throw new Error("The note moved while preparing the assignment. Run the command again.");
        const moved = destination !== sourcePath;
        if (moved) await this.app.fileManager.renameFile(file, destination);
        try {
            // No values are removed until the move succeeds. The metadata comparison also
            // catches edits and link rewrites that occurred while planning or moving.
            await this.metadata.applyTypeAssignment(file, { ...prepared, sourcePath: destination });
        } catch (error) {
            if (moved) {
                try {
                    if (file.path !== destination || this.app.vault.getAbstractFileByPath(sourcePath)) {
                        throw new Error("Original path is no longer available");
                    }
                    await this.app.fileManager.renameFile(file, sourcePath);
                } catch {
                    throw new Error(`Metadata assignment failed; the file remains at ${file.path}. ${String(error)}`);
                }
            }
            throw error;
        }
        return { ...prepared, moved };
    }
}
