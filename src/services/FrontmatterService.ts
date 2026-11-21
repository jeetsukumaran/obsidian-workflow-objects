import { App, TFile, Notice, parseYaml } from "obsidian";
import {
    TypedNoteWorkflowsSettings,
    CleanupOptions,
    CleanupAnalysis,
    CleanupStats,
    MissingFrontmatterMode,
    NoteTypeAssignmentOptions,
    NoteTypeFieldInfo,
    SchemaResolution,
    DEFAULT_CLEANUP_OPTIONS,
} from "../types";
import { NoteTypeService } from "./NoteTypeService";
import { isEmptyValue, sortEntries, SortMode } from "../utils/helpers";

/** Prepared metadata edit, retained while the destination is checked. */
export interface PreparedFrontmatterEdit {
    sourcePath: string;
    original: Record<string, unknown>;
    frontmatter: Record<string, unknown>;
    added: number;
    removed: number;
    schemaSignature?: string;
}

/**
 * Service for frontmatter manipulation operations
 */
export class FrontmatterService {
    constructor(
        private app: App,
        private settings: TypedNoteWorkflowsSettings,
        private noteTypeService: NoteTypeService
    ) {}

    /**
     * Add absent schema fields without removing fields or replacing values.
     * Append/prepend preserve existing field order and insert new fields in
     * schema order. The other modes sort the entire frontmatter, even when
     * no fields are missing. Returns the number of fields added.
     */
    async insertMissingFrontmatter(
        file: TFile,
        mode: MissingFrontmatterMode
    ): Promise<number> {
        const original = await this.readFrontmatter(file);
        const schemaSignature = this.noteTypeService.schemaSignature(file);
        const resolution = await this.noteTypeService.resolveNoteSchema(file, original);
        const frontmatter = { ...original };
        const added = this.insertFields(frontmatter, resolution.noteTypeInfo?.fieldDefaults ?? new Map(),
            resolution.noteTypeInfo?.fieldOrder ?? null, mode);
        await this.applyPreparedEdit(file, { sourcePath: file.path, original, frontmatter, added, removed: 0, schemaSignature });
        return added;
    }

    /** Parse current disk content; the metadata cache can lag behind a previous write. */
    async readFrontmatter(file: TFile): Promise<Record<string, unknown>> {
        const content = await this.app.vault.read(file);
        const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content);
        if (!opening) return {};
        const rest = content.slice(opening[0].length);
        const closing = /^(?:---|\.\.\.)[ \t]*\r?$/m.exec(rest);
        if (!closing) throw new Error("Front matter has no closing delimiter");
        const parsed: unknown = parseYaml(rest.slice(0, closing.index));
        if (parsed == null) return {};
        if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Front matter must contain named fields");
        return parsed as Record<string, unknown>;
    }

    /** Plan against the selected note type and the final location, retaining contextual classes. */
    async prepareNoteTypeAssignment(
        file: TFile,
        options: NoteTypeAssignmentOptions,
        destination = file.path,
        original?: Record<string, unknown>,
        suppliedTitle?: string,
        edits: Record<string, unknown> = {}
    ): Promise<PreparedFrontmatterEdit> {
        original ??= await this.readFrontmatter(file);
        const schemaSignature = this.noteTypeService.schemaSignature(file);
        const noteTypeField = this.noteTypeService.getNoteTypeFieldName();
        const input = { ...original, ...edits };
        const resolution = await this.noteTypeService.resolveNoteSchema(file, { ...input, [noteTypeField]: options.targetType }, destination);
        if (!resolution.schemaComplete || !resolution.noteTypeInfo) {
            throw new Error(resolution.issues.join("; ") || `No field schema available for note type "${options.targetType}"`);
        }
        const { noteTypeInfo, protectedFields } = resolution;
        const titleField = this.settings.fields.title;
        // An explicitly entered title is part of this edit, even when the
        // destination schema does not declare it.
        if (suppliedTitle !== undefined || Object.prototype.hasOwnProperty.call(edits, titleField)) protectedFields.add(titleField);
        let removed = 0;
        const removeField = (key: string, value: unknown): boolean => !protectedFields.has(key) && !noteTypeInfo.definedFields.has(key) &&
            (options.removeFields === "all" || (options.removeFields === "empty" && isEmptyValue(value)));
        const retained = Object.entries(original).filter(([key, value]) => {
            const remove = removeField(key, Object.prototype.hasOwnProperty.call(edits, key) ? edits[key] : value);
            if (remove) removed++;
            return !remove;
        }).map(([key]): [string, unknown] => [key, key === noteTypeField ? options.targetType
            : key === titleField && suppliedTitle !== undefined ? suppliedTitle : input[key]]);
        const frontmatter: Record<string, unknown> = Object.fromEntries(retained);
        const defaults = options.addMissingFields ? new Map(noteTypeInfo.fieldDefaults) : new Map<string, unknown>();
        for (const [key, value] of Object.entries(edits)) {
            if (!Object.prototype.hasOwnProperty.call(original, key) && !removeField(key, value)) defaults.set(key, value);
        }
        if (suppliedTitle !== undefined) defaults.set(titleField, suppliedTitle);
        defaults.set(noteTypeField, options.targetType);
        const mode = options.sortMode === "none" ? options.newFieldsPosition : options.sortMode;
        const added = this.insertFields(frontmatter, defaults, noteTypeInfo.fieldOrder, mode);
        return { sourcePath: file.path, original, frontmatter, added, removed, schemaSignature };
    }

    /** Check a planned edit before moving the note or committing its metadata. */
    async assertPreparedEditCurrent(file: TFile, prepared: PreparedFrontmatterEdit): Promise<void> {
        this.validatePreparedEdit(file, await this.readFrontmatter(file), prepared);
    }

    /** Apply an edit only if its metadata, schema, and path still match. */
    async applyPreparedEdit(file: TFile, prepared: PreparedFrontmatterEdit): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            this.validatePreparedEdit(file, fm, prepared);
            this.replaceFields(fm, Object.entries(prepared.frontmatter));
        });
    }

    /** Change selected keys without overwriting unrelated edits or link updates. */
    async applyFieldPatch(file: TFile, sourcePath: string, before: Record<string, unknown>, after: Record<string, unknown>): Promise<void> {
        const present = (fm: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(fm, key);
        const equal = (a: Record<string, unknown>, b: Record<string, unknown>, key: string) =>
            present(a, key) === present(b, key) && JSON.stringify(a[key]) === JSON.stringify(b[key]);
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !equal(before, after, key));
        if (!keys.length) return;
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            if (file.path !== sourcePath || keys.some(key => !equal(fm, before, key))) {
                throw new Error(`Metadata changed during rename: ${sourcePath}`);
            }
            for (const key of keys) {
                if (present(after, key)) Object.defineProperty(fm, key, {
                    value: after[key], enumerable: true, configurable: true, writable: true,
                });
                else delete fm[key];
            }
        });
    }

    private validatePreparedEdit(file: TFile, fm: Record<string, unknown>, prepared: PreparedFrontmatterEdit): void {
        if (prepared.schemaSignature && prepared.schemaSignature !== this.noteTypeService.schemaSignature(file)) {
            throw new Error("The schema or class bindings changed while preparing the edit. Run the command again.");
        }
        if (file.path !== prepared.sourcePath || JSON.stringify(fm) !== JSON.stringify(prepared.original)) {
            throw new Error("The note changed while preparing the edit. Run the command again.");
        }
    }

    /** Insert defaults and arrange fields for both insertion and note type assignment. */
    private insertFields(
        fm: Record<string, unknown>,
        defaults: Map<string, unknown>,
        fieldOrder: string[] | null,
        mode: MissingFrontmatterMode
    ): number {
        const missing = [...defaults].filter(([key]) => !Object.prototype.hasOwnProperty.call(fm, key));
        if (missing.length === 0 && (mode === "append" || mode === "prepend")) return 0;
        const existing = Object.entries(fm);
        let entries: [string, unknown][];
        if (mode === "append" || mode === "prepend") {
            const orderedMissing = sortEntries(missing, fieldOrder, "schema");
            entries = mode === "prepend" ? [...orderedMissing, ...existing] : [...existing, ...orderedMissing];
        } else {
            entries = sortEntries([...existing, ...missing], fieldOrder, mode);
        }
        this.replaceFields(fm, entries);
        return missing.length;
    }

    private replaceFields(fm: Record<string, unknown>, entries: [string, unknown][]): void {
        for (const key of Object.keys(fm)) delete fm[key];
        for (const [key, value] of entries) {
            // Define own properties even for names such as "__proto__".
            Object.defineProperty(fm, key, { value, enumerable: true, configurable: true, writable: true });
        }
    }

    /** Sort without removing empty properties or adding defaults. */
    async sortFrontmatter(file: TFile, mode: "schema" | "alphabetical" | "default" = "default"): Promise<void> {
        const sortMode: SortMode = mode === "default" ? this.settings.defaultFieldSort : mode;
        await this.cleanFrontmatter(file, {
            preserveDefinedFields: true, removeUndefinedFields: false, removeEmptyUndefinedFields: false,
            addMissingFields: false, sortMode,
        });
        new Notice(`Sorted front matter (${sortMode})`);
    }

    /** The same removal policy drives preview and execution. Unknown schemas never authorize deletion. */
    analyzeCleanup(
        fm: Record<string, unknown>, noteTypeInfo: NoteTypeFieldInfo | null, options: CleanupOptions,
        schemaComplete = true, protectedFields = new Set([this.noteTypeService.getNoteTypeFieldName()])
    ): CleanupAnalysis {
        const toRemove: CleanupAnalysis["toRemove"] = [];
        for (const [key, value] of Object.entries(fm)) {
            if (protectedFields.has(key)) continue;
            const isEmpty = isEmptyValue(value);
            const defined = noteTypeInfo?.definedFields.has(key) ?? false;
            const remove = defined ? isEmpty && !options.preserveDefinedFields
                : schemaComplete && ((isEmpty && options.removeEmptyUndefinedFields !== false) ||
                    (options.removeUndefinedFields && noteTypeInfo !== null));
            if (remove) toRemove.push({ key, value, isEmpty });
        }
        const toAdd = options.addMissingFields && noteTypeInfo
            ? [...noteTypeInfo.fieldDefaults.keys()].filter(key => !Object.prototype.hasOwnProperty.call(fm, key)) : [];
        return { toRemove, toAdd };
    }

    async prepareCleanup(file: TFile, options: CleanupOptions): Promise<{
        prepared: PreparedFrontmatterEdit; analysis: CleanupAnalysis; stats: CleanupStats; resolution: SchemaResolution;
    }> {
        const original = await this.readFrontmatter(file);
        const schemaSignature = this.noteTypeService.schemaSignature(file);
        const resolution = await this.noteTypeService.resolveNoteSchema(file, original);
        const { noteTypeInfo, schemaComplete, protectedFields } = resolution;
        const analysis = this.analyzeCleanup(original, noteTypeInfo, options, schemaComplete, protectedFields);
        const removed = new Set(analysis.toRemove.map(entry => entry.key));
        const frontmatter = Object.fromEntries(Object.entries(original).filter(([key]) => !removed.has(key)));
        const added = this.insertFields(frontmatter, options.addMissingFields ? noteTypeInfo?.fieldDefaults ?? new Map() : new Map(),
            noteTypeInfo?.fieldOrder ?? null, options.sortMode === "none" ? "append" : options.sortMode);
        const stats: CleanupStats = {
            removed: [...removed], added: Object.keys(frontmatter).filter(key => !Object.prototype.hasOwnProperty.call(original, key)),
            preserved: Object.keys(original).filter(key => !removed.has(key) && isEmptyValue(original[key]) && noteTypeInfo?.definedFields.has(key)),
        };
        return { prepared: { sourcePath: file.path, original, frontmatter, added, removed: removed.size, schemaSignature }, analysis, stats, resolution };
    }

    async cleanFrontmatter(file: TFile, options: CleanupOptions = DEFAULT_CLEANUP_OPTIONS): Promise<CleanupStats> {
        const plan = await this.prepareCleanup(file, options);
        await this.applyPreparedEdit(file, plan.prepared);
        if (!plan.resolution.schemaComplete) new Notice(`Unknown fields preserved: ${plan.resolution.issues.join("; ")}`);
        return plan.stats;
    }

    /**
     * Purge all empty fields (legacy function)
     */
    async purgeEmptyFields(file: TFile): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (!fm) return;

            const removed: string[] = [];

            for (const key of Object.keys(fm)) {
                if (isEmptyValue(fm[key])) {
                    removed.push(key);
                    delete fm[key];
                }
            }

            const sorted = Object.entries(fm).sort(([a], [b]) =>
                a.localeCompare(b, undefined, { sensitivity: "base" })
            );

            for (const key of Object.keys(fm)) delete fm[key];
            for (const [key, value] of sorted) fm[key] = value;

            const msg = removed.length
                ? `Removed: ${removed.join(", ")}. ${sorted.length} field(s) sorted.`
                : `${sorted.length} field(s) sorted.`;
            new Notice(msg);
        });
    }
}
