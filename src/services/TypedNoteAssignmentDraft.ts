import { App, TFile } from "obsidian";
import { NoteTypeAssignmentOptions, TypedNoteWorkflowsSettings } from "../types";
import { FilePathInfo } from "../utils/pathUtils";
import { TypedNoteField, TypedNoteFieldService, fieldChanged, inferredField } from "./TypedNoteFieldService";
import { FrontmatterService } from "./FrontmatterService";
import { NoteTypeService } from "./NoteTypeService";
import { TypedNoteUpdateResult, TypedNoteUpdateService, PlannedTypedNoteUpdate } from "./TypedNoteUpdateService";

/** An editable assignment snapshot; policy and file mutations remain in the update services. */
export class TypedNoteAssignmentDraft {
    fields: TypedNoteField[] = [];
    readonly fieldService: TypedNoteFieldService;
    readonly noteTypeName: string;
    summary = "";
    private original: Record<string, unknown> = {};
    private sourcePath: string;
    private signature = "";
    private cachedFields = new Map<string, TypedNoteField>();
    private fieldSignatures = new Map<string, string>();
    private updates: TypedNoteUpdateService;
    private previewQueue: Promise<unknown> = Promise.resolve();

    constructor(app: App, private file: TFile, private settings: TypedNoteWorkflowsSettings,
        private noteTypes: NoteTypeService, private metadata: FrontmatterService, private options: NoteTypeAssignmentOptions) {
        this.sourcePath = file.path;
        this.noteTypeName = options.targetType;
        this.fieldService = new TypedNoteFieldService(app, [], field => noteTypes.getDateFormat(field), new Date(), file.path);
        this.updates = new TypedNoteUpdateService(app, settings, noteTypes, metadata);
    }

    async initialize(): Promise<void> {
        this.original = await this.metadata.readFrontmatter(this.file);
        this.signature = this.noteTypes.schemaSignature(this.file);
        const plan = await this.updates.planAssignment(this.file, this.options, this.original, () => ({}));
        await this.syncFields(plan);
        const title = this.fields.find(field => field.definition.name === this.settings.fields.title);
        const oldTitle = this.original[this.settings.fields.title];
        if (title && this.requiresTitle() && (oldTitle == null || typeof oldTitle === "string" && !oldTitle.trim())) {
            title.text = this.file.basename;
            title.dirty = true;
            title.hint = "Required for renaming. Suggested from the current filename.";
        }
    }

    private requiresTitle(): boolean { return this.options.updateFileLocation && this.options.autoRename; }

    private editedValues(destination: string, validate: boolean): Record<string, unknown> {
        // Keep explicit edits even if a removal policy hides their fields in a later preview.
        const fields = [...this.cachedFields.values()].filter(field => fieldChanged(field) ||
            (!field.initial && this.options.addMissingFields && this.fields.includes(field)));
        const values = this.fieldService.values(fields, destination, validate);
        const editedTitle = values[this.settings.fields.title];
        if (typeof editedTitle === "string") values[this.settings.fields.title] = editedTitle.trim();
        const title = Object.prototype.hasOwnProperty.call(values, this.settings.fields.title)
            ? values[this.settings.fields.title] : this.original[this.settings.fields.title];
        if (validate && this.requiresTitle() && (typeof title !== "string" || !title.trim())) {
            throw new Error("Enter a title before renaming the typed note.");
        }
        return values;
    }

    private async syncFields(plan: PlannedTypedNoteUpdate): Promise<void> {
        const resolution = await this.noteTypes.resolveNoteSchema(this.file, plan.frontmatter, plan.path.fullPath);
        if (!resolution.schemaComplete || !resolution.noteTypeInfo) throw new Error(resolution.issues.join("; ") || "No schema available");
        const schema = resolution.noteTypeInfo;
        this.fieldService.setDefinitions([...schema.fields, ...schema.nestedFields]);
        const noteTypeField = this.noteTypes.getNoteTypeFieldName();
        const definitions = schema.fields.filter(field => field.name !== noteTypeField);
        for (const name of Object.keys(plan.frontmatter)) {
            if (name !== noteTypeField && !definitions.some(field => field.name === name)) definitions.push(inferredField(name, plan.frontmatter[name]));
        }
        if (this.requiresTitle() && !definitions.some(field => field.name === this.settings.fields.title)) {
            definitions.unshift({ name: this.settings.fields.title, type: "Input" });
        }
        const next: TypedNoteField[] = [];
        for (const definition of definitions) {
            const childPath = definition.id ? `${definition.path ? definition.path + "____" : ""}${definition.id}` : undefined;
            const signature = JSON.stringify([definition, childPath ? schema.nestedFields.filter(child =>
                child.path === childPath || child.path?.startsWith(childPath + "____")) : []]);
            let field = this.cachedFields.get(definition.name);
            if (!field || this.fieldSignatures.get(definition.name) !== signature) {
                const dirty = field ? fieldChanged(field) : false;
                const values = field && dirty ? { ...this.original, ...this.fieldService.values([field], plan.path.fullPath, false) } : this.original;
                [field] = await this.fieldService.makeFields([definition], values);
                field.dirty = dirty;
                if (!field.initial && !this.options.addMissingFields) field.hint = "New field. Added only if you edit it; automatic insertion is disabled.";
                this.cachedFields.set(definition.name, field);
                this.fieldSignatures.set(definition.name, signature);
            }
            next.push(field);
        }
        if (next.length !== this.fields.length || next.some((field, index) => field !== this.fields[index])) this.fields = next;
        const removed = Object.keys(this.original).filter(key => !Object.prototype.hasOwnProperty.call(plan.frontmatter, key));
        this.summary = removed.length ? `Fields to remove: ${removed.join(", ")}.` : "No existing fields will be removed.";
    }

    private assertSnapshot(): void {
        if (this.file.path !== this.sourcePath || this.signature !== this.noteTypes.schemaSignature(this.file)) {
            throw new Error("The note's path or schema changed while the form was open. Reopen the assignment dialog.");
        }
    }

    private async prepare(validate: boolean): Promise<PlannedTypedNoteUpdate> {
        this.assertSnapshot();
        const plan = await this.updates.planAssignment(this.file, this.options, this.original,
            destination => this.editedValues(destination, validate));
        return { ...plan, sourcePath: this.sourcePath, schemaSignature: this.signature };
    }

    preview(): Promise<FilePathInfo> {
        const preview = this.previewQueue.catch(() => undefined).then(async () => {
            const plan = await this.prepare(false);
            await this.syncFields(plan);
            return plan.path;
        });
        this.previewQueue = preview;
        return preview;
    }

    async save(): Promise<TypedNoteUpdateResult> {
        await this.previewQueue.catch(() => undefined);
        const plan = await this.prepare(true);
        const fields = this.fields;
        await this.syncFields(plan);
        if (fields !== this.fields) throw new Error("The destination has additional fields. Review the updated form before assigning the note type.");
        return this.updates.apply(this.file, plan);
    }
}
