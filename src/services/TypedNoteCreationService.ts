import { App, normalizePath, stringifyYaml, TFile, TFolder } from "obsidian";
import { FieldDefinition, NoteTypeFieldInfo, TypedNoteWorkflowsSettings } from "../types";
import { sortEntries } from "../utils/helpers";
import { computeFilePath, ensureFolderExists, FilePathInfo } from "../utils/pathUtils";
import { TypedNoteField, TypedNoteFieldService } from "./TypedNoteFieldService";
import { NoteTypeService } from "./NoteTypeService";

/** One creation draft owns field values, destination preview, and the final write. */
export class TypedNoteCreationService {
    fields: TypedNoteField[] = [];
    readonly fieldService: TypedNoteFieldService;
    folderOverride: string | undefined;
    filenameOverride: string | undefined;
    private createdAt = new Date();

    constructor(
        private app: App,
        private settings: TypedNoteWorkflowsSettings,
        private noteTypes: NoteTypeService,
        readonly noteTypeName: string,
        private schema: NoteTypeFieldInfo,
        private body: string
    ) {
        this.fieldService = new TypedNoteFieldService(app, [...schema.fields, ...schema.nestedFields], field => noteTypes.getDateFormat(field), this.createdAt);
    }

    async initialize(): Promise<void> {
        const definitions = this.schema.fields.filter(field => field.name !== this.noteTypes.getNoteTypeFieldName());
        // The configured title is always available, including schemas which omit it.
        const title: FieldDefinition = { name: this.settings.fields.title, type: "Input" };
        const index = definitions.findIndex(field => field.name === title.name);
        if (index < 0) definitions.unshift(title);
        else definitions[index] = { ...definitions[index], type: "Input" };
        this.fields = await this.fieldService.makeFields(definitions);
        const titleField = this.fields.find(field => field.definition.name === title.name);
        if (titleField) titleField.hint = "Required. Used by the filename rules.";
    }

    private frontmatter(sourcePath: string, validate: boolean): Record<string, unknown> {
        const values = this.fieldService.values(this.fields, sourcePath, validate);
        const title = values[this.settings.fields.title];
        if (validate && (typeof title !== "string" || !title.trim())) throw new Error("Enter a title before creating the typed note.");
        values[this.settings.fields.title] = typeof title === "string" ? title.trim() : "";
        return { ...values, [this.noteTypes.getNoteTypeFieldName()]: this.noteTypeName };
    }

    private async prepare(validate: boolean): Promise<{ path: FilePathInfo; frontmatter: Record<string, unknown> }> {
        let sourcePath = "";
        // Links are generated relative to the final destination, including folder overrides.
        // Re-evaluate templates if they use link fields; reject a circular destination rule.
        for (let attempt = 0; attempt < 5; attempt++) {
            const frontmatter = this.frontmatter(sourcePath, validate);
            const filename = this.filenameOverride?.trim();
            if (filename !== undefined && (!filename || /[/\\]/.test(filename))) throw new Error("Enter a filename without folders. Use the directory override for folders.");
            const path = await computeFilePath(this.settings, this.noteTypeName, frontmatter[this.settings.fields.title] as string,
                null, this.createdAt.getTime(), frontmatter, {
                    folder: this.folderOverride?.trim(),
                    basename: filename?.replace(/\.md$/i, ""),
                });
            this.validatePath(path);
            if (sourcePath === path.fullPath) return { path, frontmatter };
            sourcePath = path.fullPath;
        }
        throw new Error("The destination rules depend on links whose paths change with the destination. Override the directory and filename.");
    }

    private validatePath(path: FilePathInfo): void {
        if (!path.basename.trim() || path.basename === "." || path.basename === ".." || /[/\\]/.test(path.basename)) {
            throw new Error("The filename is empty or contains a folder separator.");
        }
        path.folder = path.folder.replace(/\/+$/, "");
        path.fullPath = path.folder ? `${path.folder}/${path.basename}.md` : `${path.basename}.md`;
        const parts = path.fullPath.split("/");
        if (parts.some(part => !part || part === "." || part === ".." || /[\\:*?"<>|]/.test(part) ||
            [...part].some(character => character.charCodeAt(0) < 32) || part.endsWith(".") || part.endsWith(" "))) {
            throw new Error("Use a vault-relative path with valid folder and file names; '.' and '..' are not allowed.");
        }
        path.fullPath = normalizePath(path.fullPath);
        path.folder = path.fullPath.slice(0, Math.max(0, path.fullPath.lastIndexOf("/")));
        if (this.app.vault.getAbstractFileByPath(path.fullPath)) throw new Error(`File already exists: ${path.fullPath}`);
        let parent = "";
        for (const part of path.folder.split("/").filter(Boolean)) {
            parent = parent ? `${parent}/${part}` : part;
            const existing = this.app.vault.getAbstractFileByPath(parent);
            if (existing && !(existing instanceof TFolder)) throw new Error(`A file blocks the directory: ${parent}`);
        }
    }

    async preview(): Promise<FilePathInfo> { return (await this.prepare(false)).path; }

    async save(): Promise<TFile> {
        const latest = await this.noteTypes.getNoteTypeFieldInfo(this.noteTypeName);
        if (!latest || JSON.stringify([latest.fields, latest.nestedFields]) !== JSON.stringify([this.schema.fields, this.schema.nestedFields])) {
            throw new Error("The note type schema changed while this form was open. Reopen the creation form to use its current fields.");
        }
        const { path, frontmatter } = await this.prepare(true);
        const ordered = Object.fromEntries(sortEntries(Object.entries(frontmatter), this.schema.fieldOrder, this.settings.defaultFieldSort));
        const content = `---\n${stringifyYaml(ordered).trimEnd()}\n---\n${this.body}`;
        await ensureFolderExists(this.app, path.folder);
        // vault.create also rejects a collision introduced after validation; never overwrite.
        return this.app.vault.create(path.fullPath, content);
    }
}
