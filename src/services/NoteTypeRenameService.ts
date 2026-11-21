import { App, TFile, TFolder } from "obsidian";
import { TypedNoteWorkflowsSettings } from "../types";
import { stringList } from "../schema/definitions";
import { ensureFolderExists } from "../utils/pathUtils";
import { FrontmatterService } from "./FrontmatterService";
import { NoteTypeService, SchemaPlugin } from "./NoteTypeService";

interface FileEdit {
    file: TFile;
    path: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}
interface SettingChange {
    record: Record<string, unknown>;
    key: string;
    before: unknown;
    after: unknown;
}
interface SettingsEdit {
    changes: SettingChange[];
    save: () => Promise<void>;
}
export interface NoteTypeRenameResult { filesUpdated: number }

const running = new WeakSet<App>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Rename class identity and its declared references as one recoverable operation. */
export class NoteTypeRenameService {
    constructor(
        private app: App,
        private settings: TypedNoteWorkflowsSettings,
        private noteTypes: NoteTypeService,
        private metadata: FrontmatterService,
        private saveSettings: () => Promise<void>,
    ) {}

    /** Shared by live dialog validation and the final write. Names are schema-relative. */
    validateName(oldName: string, input: string): string | null {
        const name = input.trim();
        if (!name) return "Enter a new note type name.";
        if (name.toLowerCase() === oldName.toLowerCase()) return "Choose a different note type name.";
        if (name.toLowerCase().endsWith(".md")) return "Enter the note type name without .md.";
        if (/[\\:*?"<>|#[\],]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.split("/").some(part =>
            !part || part.startsWith(".") || part !== part.trim() || part.endsWith(".") ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
            return "Use a valid note type name or subfolder/name within the note types folder.";
        }
        const path = `${this.noteTypes.getNoteTypesPath()}/${name}.md`;
        if (this.app.vault.getAbstractFileByPath(path) || this.app.vault.getFiles().some(file =>
            file.path.toLowerCase() === path.toLowerCase())) return `A file or note type named "${name}" already exists.`;
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) {
            const parent = this.app.vault.getAbstractFileByPath(parts.slice(0, i).join("/"));
            if (parent && !(parent instanceof TFolder)) return `A file blocks the destination folder: ${parent.path}`;
        }
        return null;
    }

    async rename(oldName: string, input: string): Promise<NoteTypeRenameResult> {
        if (running.has(this.app)) throw new Error("A note type rename is already running.");
        running.add(this.app);
        try { return await this.performRename(oldName, input.trim()); }
        finally { running.delete(this.app); }
    }

    private async performRename(oldName: string, newName: string): Promise<NoteTypeRenameResult> {
        const invalid = this.validateName(oldName, newName);
        if (invalid) throw new Error(invalid);
        const definition = this.noteTypes.getNoteTypeFile(oldName);
        if (!definition) throw new Error(`Note type no longer exists: ${oldName}`);
        const provider = this.noteTypes.getSchemaProviderForEdits();
        const context = this.context();
        const sourcePath = definition.path;
        const destination = `${this.noteTypes.getNoteTypesPath()}/${newName}.md`;
        const keys = new Set([this.noteTypes.getNoteTypeFieldName()]);
        const alias = provider?.settings?.fileClassAlias;
        if (provider) keys.add(typeof alias === "string" && alias ? alias : "fileClass");
        const edits: FileEdit[] = [];
        // Read every Markdown file, including templates and schema notes. The cache
        // may be stale and cannot establish that all declarations were discovered.
        for (const file of this.app.vault.getMarkdownFiles()) {
            const before = await this.read(file);
            const after = this.renameDeclarations(file, before, keys, oldName, newName);
            if (file === definition) {
                const mapped = typeof before.mapWithTag === "string" ? before.mapWithTag.toLowerCase() === "true" : !!before.mapWithTag;
                if (mapped) after.tagNames = [...new Set([...stringList(before.tagNames), oldName])];
                // Keep an existing generated view reachable when its name was implicit.
                if (provider && this.noteTypes.getSource() === "fileclass" && before.baseFile && !before.baseView) after.baseView = oldName;
            }
            if (!same(before, after)) edits.push({ file, path: file.path, before, after });
        }
        const settingsEdits = this.settingsEdits(provider, oldName, newName);
        const assertContext = () => {
            if (context !== this.context() || provider !== this.noteTypes.getSchemaProviderForEdits()) {
                throw new Error("Schema source, folder, or note type field changed during rename. Run the command again.");
            }
        };
        assertContext();
        const collision = this.validateName(oldName, newName);
        if (collision) throw new Error(collision);
        if (definition.path !== sourcePath || this.noteTypes.getNoteTypeFile(oldName) !== definition) throw new Error("The note type definition moved during rename.");

        const completed: FileEdit[] = [];
        const saved: SettingsEdit[] = [];
        let moved = false;
        try {
            await ensureFolderExists(this.app, destination.slice(0, destination.lastIndexOf("/")));
            assertContext();
            const occupied = this.validateName(oldName, newName);
            if (occupied) throw new Error(occupied);
            if (definition.path !== sourcePath || this.noteTypes.getNoteTypeFile(oldName) !== definition) throw new Error("The note type definition moved during rename.");
            await this.app.fileManager.renameFile(definition, destination);
            moved = true;
            for (const edit of edits) {
                assertContext();
                await this.metadata.applyFieldPatch(edit.file, edit.file === definition ? destination : edit.path, edit.before, edit.after);
                completed.push(edit);
            }
            for (const edit of settingsEdits) {
                assertContext();
                this.applySettings(edit, false);
                saved.push(edit); // Saving can fail after changing the in-memory settings.
                await edit.save();
            }
            // A note created or edited during the scan must not silently retain the old note type.
            assertContext();
            for (const file of this.app.vault.getMarkdownFiles()) {
                const current = await this.read(file);
                if (!same(current, this.renameDeclarations(file, current, keys, oldName, newName))) {
                    throw new Error(`An old note type declaration appeared during rename: ${file.path}`);
                }
            }
            if (definition.path !== destination || this.app.vault.getAbstractFileByPath(destination) !== definition) {
                throw new Error("The renamed note type definition moved or was deleted during the operation.");
            }
            return { filesUpdated: edits.length };
        } catch (error) {
            const failures: string[] = [];
            for (const edit of [...completed].reverse()) {
                try { await this.metadata.applyFieldPatch(edit.file, edit.file === definition ? destination : edit.path, edit.after, edit.before); }
                catch (rollbackError) { failures.push(`${edit.file.path}: ${message(rollbackError)}`); }
            }
            if (moved || definition.path === destination) {
                try {
                    if (definition.path !== destination || this.app.vault.getAbstractFileByPath(sourcePath)) throw new Error("Original path is unavailable");
                    await this.app.fileManager.renameFile(definition, sourcePath);
                } catch (rollbackError) { failures.push(`${definition.path}: ${message(rollbackError)}`); }
            }
            for (const edit of [...saved].reverse()) {
                try { this.applySettings(edit, true); await edit.save(); }
                catch (rollbackError) { failures.push(`Settings: ${message(rollbackError)}`); }
            }
            throw new Error(`${message(error)}${failures.length ? ` Rollback incomplete: ${failures.join("; ")}` : " Rename changes were rolled back."}`);
        }
    }

    private context(): string {
        return JSON.stringify([this.noteTypes.getSource(), this.noteTypes.getNoteTypesPath(), this.noteTypes.getNoteTypeFieldName(),
            this.noteTypes.getSchemaProviderForEdits()?.settings?.fileClassAlias]);
    }

    private async read(file: TFile): Promise<Record<string, unknown>> {
        try { return await this.metadata.readFrontmatter(file); }
        catch (error) { throw new Error(`Cannot read metadata in ${file.path}: ${message(error)}`); }
    }

    private renameDeclarations(file: TFile, fm: Record<string, unknown>, keys: Set<string>, oldName: string, newName: string): Record<string, unknown> {
        const result = { ...fm };
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(fm, key)) result[key] = renameReference(fm[key], oldName, newName);
        }
        if (this.noteTypes.isNoteTypeDefinitionFile(file) && typeof fm.extends === "string" && fm.extends.trim() === oldName) result.extends = newName;
        // Metadata Menu saved views explicitly name the child classes they include.
        if (this.noteTypes.isNoteTypeDefinitionFile(file) && Array.isArray(fm.savedViews)) {
            result.savedViews = fm.savedViews.map((view: unknown) => {
                if (!view || typeof view !== "object" || Array.isArray(view)) return view;
                const saved = view as Record<string, unknown>;
                return Object.prototype.hasOwnProperty.call(saved, "children")
                    ? { ...saved, children: renameReference(saved.children, oldName, newName) } : view;
            });
        }
        return result;
    }

    private settingsEdits(provider: SchemaPlugin | undefined, oldName: string, newName: string): SettingsEdit[] {
        const edits: SettingsEdit[] = [];
        const own: SettingChange[] = [];
        const add = (changes: SettingChange[], record: Record<string, unknown>, key: string, after: unknown) => {
            if (!same(record[key], after) && !changes.some(change => change.record === record && change.key === key)) {
                changes.push({ record, key, before: record[key], after });
            }
        };
        const config = this.settings as unknown as Record<string, unknown>;
        if (this.settings.typeAssignment.targetType === oldName) add(own, config, "typeAssignment", { ...this.settings.typeAssignment, targetType: newName });
        // Only exact, anchored literal patterns can be migrated without interpreting
        // arbitrary regular expressions or Liquid/JavaScript code.
        for (const key of ["pathMappings", "filenameMappings"] as const) {
            add(own, config, key, this.settings[key].map(([pattern, template]) =>
                [pattern === `^${escapeRegex(oldName)}$` ? `^${escapeRegex(newName)}$` : pattern, template]));
        }
        if (own.length) edits.push({ changes: own, save: this.saveSettings });
        if (provider?.settings) {
            const changes: SettingChange[] = [];
            if (provider.settings.globalFileClass === oldName) add(changes, provider.settings, "globalFileClass", newName);
            if (this.noteTypes.getSource() === "metadata-menu") {
                for (const queries of [provider.settings.fileClassQueries, provider.initialFileClassQueries]) {
                    if (!Array.isArray(queries)) continue;
                    for (const query of queries) {
                        if (query && typeof query === "object" && query.fileClassName === oldName) add(changes, query as Record<string, unknown>, "fileClassName", newName);
                    }
                }
            }
            if (changes.length) {
                if (!provider.saveSettings) throw new Error("The schema integration cannot save its note type references. Rename cancelled.");
                edits.push({ changes, save: () => provider.saveSettings!() });
            }
        }
        return edits;
    }

    private applySettings(edit: SettingsEdit, reverse: boolean): void {
        for (const change of edit.changes) {
            if (!same(change.record[change.key], reverse ? change.after : change.before)) throw new Error(`Setting changed during rename: ${change.key}`);
        }
        for (const change of edit.changes) change.record[change.key] = reverse ? change.before : change.after;
    }
}

/** Preserve scalar/list encodings and whitespace; never replace substrings. */
function renameReference(value: unknown, oldName: string, newName: string): unknown {
    const replace = (item: unknown): unknown => typeof item === "string"
        ? item.split(",").map(part => part.trim() === oldName ? part.replace(oldName, () => newName) : part).join(",") : item;
    return Array.isArray(value) ? value.map(replace) : replace(value);
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
