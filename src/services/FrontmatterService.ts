import { App, TFile, Notice, parseYaml } from "obsidian";
import {
    WorkflowObjectsSettings,
    CleanupOptions,
    CleanupAnalysis,
    CleanupStats,
    MissingFrontmatterMode,
    TypeAssignmentOptions,
    TypeFieldInfo,
    SchemaResolution,
    DEFAULT_CLEANUP_OPTIONS,
} from "../types";
import { TypeService } from "./TypeService";
import { isEmptyValue, sortEntries, SortMode } from "../utils/helpers";

/** Prepared metadata edit, retained while the destination is checked. */
export interface PreparedTypeAssignment {
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
        private settings: WorkflowObjectsSettings,
        private typeService: TypeService
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
        const schemaSignature = this.typeService.schemaSignature(file);
        const resolution = await this.typeService.resolveNoteSchema(file, original);
        const frontmatter = { ...original };
        const added = this.insertFields(frontmatter, resolution.typeInfo?.fieldDefaults ?? new Map(),
            resolution.typeInfo?.fieldOrder ?? null, mode);
        await this.applyTypeAssignment(file, { sourcePath: file.path, original, frontmatter, added, removed: 0, schemaSignature });
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

    /** Plan against the selected type and the final location, retaining contextual classes. */
    async prepareTypeAssignment(
        file: TFile,
        options: TypeAssignmentOptions,
        destination = file.path,
        original?: Record<string, unknown>
    ): Promise<PreparedTypeAssignment> {
        original ??= await this.readFrontmatter(file);
        const schemaSignature = this.typeService.schemaSignature(file);
        const typeField = this.typeService.getTypeFieldName();
        const resolution = await this.typeService.resolveNoteSchema(file, { ...original, [typeField]: options.targetType }, destination);
        if (!resolution.schemaComplete || !resolution.typeInfo) {
            throw new Error(resolution.issues.join("; ") || `No field schema available for type "${options.targetType}"`);
        }
        const { typeInfo, protectedFields } = resolution;
        let removed = 0;
        const retained = Object.entries(original).filter(([key, value]) => {
            const remove = !protectedFields.has(key) && !typeInfo.definedFields.has(key) &&
                (options.removeFields === "all" || (options.removeFields === "empty" && isEmptyValue(value)));
            if (remove) removed++;
            return !remove;
        }).map(([key, value]): [string, unknown] => [key, key === typeField ? options.targetType : value]);
        const frontmatter: Record<string, unknown> = Object.fromEntries(retained);
        const defaults = options.addMissingFields ? new Map(typeInfo.fieldDefaults) : new Map<string, unknown>();
        defaults.set(typeField, options.targetType);
        const mode = options.sortMode === "none" ? options.newFieldsPosition : options.sortMode;
        const added = this.insertFields(frontmatter, defaults, typeInfo.fieldOrder, mode);
        return { sourcePath: file.path, original, frontmatter, added, removed, schemaSignature };
    }

    /** Apply a prepared assignment only if its metadata and source path still match. */
    async applyTypeAssignment(file: TFile, prepared: PreparedTypeAssignment): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            if (prepared.schemaSignature && prepared.schemaSignature !== this.typeService.schemaSignature(file)) {
                throw new Error("The schema or class bindings changed while preparing the edit. Run the command again.");
            }
            if (file.path !== prepared.sourcePath || JSON.stringify(fm) !== JSON.stringify(prepared.original)) {
                throw new Error("The note changed while preparing the assignment. Run the command again.");
            }
            this.replaceFields(fm, Object.entries(prepared.frontmatter));
        });
    }

    /** Insert defaults and arrange fields for both insertion and type assignment. */
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
        fm: Record<string, unknown>, typeInfo: TypeFieldInfo | null, options: CleanupOptions,
        schemaComplete = true, protectedFields = new Set([this.typeService.getTypeFieldName()])
    ): CleanupAnalysis {
        const toRemove: CleanupAnalysis["toRemove"] = [];
        for (const [key, value] of Object.entries(fm)) {
            if (protectedFields.has(key)) continue;
            const isEmpty = isEmptyValue(value);
            const defined = typeInfo?.definedFields.has(key) ?? false;
            const remove = defined ? isEmpty && !options.preserveDefinedFields
                : schemaComplete && ((isEmpty && options.removeEmptyUndefinedFields !== false) ||
                    (options.removeUndefinedFields && typeInfo !== null));
            if (remove) toRemove.push({ key, value, isEmpty });
        }
        const toAdd = options.addMissingFields && typeInfo
            ? [...typeInfo.fieldDefaults.keys()].filter(key => !Object.prototype.hasOwnProperty.call(fm, key)) : [];
        return { toRemove, toAdd };
    }

    async prepareCleanup(file: TFile, options: CleanupOptions): Promise<{
        prepared: PreparedTypeAssignment; analysis: CleanupAnalysis; stats: CleanupStats; resolution: SchemaResolution;
    }> {
        const original = await this.readFrontmatter(file);
        const schemaSignature = this.typeService.schemaSignature(file);
        const resolution = await this.typeService.resolveNoteSchema(file, original);
        const { typeInfo, schemaComplete, protectedFields } = resolution;
        const analysis = this.analyzeCleanup(original, typeInfo, options, schemaComplete, protectedFields);
        const removed = new Set(analysis.toRemove.map(entry => entry.key));
        const frontmatter = Object.fromEntries(Object.entries(original).filter(([key]) => !removed.has(key)));
        const added = this.insertFields(frontmatter, options.addMissingFields ? typeInfo?.fieldDefaults ?? new Map() : new Map(),
            typeInfo?.fieldOrder ?? null, options.sortMode === "none" ? "append" : options.sortMode);
        const stats: CleanupStats = {
            removed: [...removed], added: Object.keys(frontmatter).filter(key => !Object.prototype.hasOwnProperty.call(original, key)),
            preserved: Object.keys(original).filter(key => !removed.has(key) && isEmptyValue(original[key]) && typeInfo?.definedFields.has(key)),
        };
        return { prepared: { sourcePath: file.path, original, frontmatter, added, removed: removed.size, schemaSignature }, analysis, stats, resolution };
    }

    async cleanFrontmatter(file: TFile, options: CleanupOptions = DEFAULT_CLEANUP_OPTIONS): Promise<CleanupStats> {
        const plan = await this.prepareCleanup(file, options);
        await this.applyTypeAssignment(file, plan.prepared);
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
