import { App, TFile, Notice, parseYaml } from "obsidian";
import {
    WorkflowObjectsSettings,
    CleanupOptions,
    CleanupAnalysis,
    CleanupStats,
    MissingFrontmatterMode,
    TypeAssignmentOptions,
    TypeFieldInfo,
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
        let added = 0;

        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            // Resolve from the current document inside the atomic update;
            // the metadata cache may still describe an earlier type.
            const rawType = fm[this.typeService.getTypeFieldName()];
            const typeValue = typeof rawType === "string" ? rawType : undefined;
            const { typeInfo } = this.typeService.resolveTypeInfo(typeValue);
            const fieldOrder = (typeValue
                ? this.typeService.getFieldSortOrder(typeValue)
                : null) ?? typeInfo?.fieldOrder ?? null;

            added = this.insertFields(fm, typeInfo?.fieldDefaults ?? new Map(), fieldOrder, mode);
        });

        return added;
    }

    /** Read current metadata and calculate the assignment without writing it. */
    async prepareTypeAssignment(file: TFile, options: TypeAssignmentOptions): Promise<PreparedTypeAssignment> {
        const typeInfo = this.typeService.getTypeFieldInfo(options.targetType);
        if (!typeInfo) {
            throw new Error(`No field schema available for type "${options.targetType}"`);
        }
        const sourcePath = file.path;
        const content = await this.app.vault.read(file);
        // Delimiter parsing also works on the minimum supported Obsidian version.
        const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content);
        let original: Record<string, unknown> = {};
        if (opening) {
            const rest = content.slice(opening[0].length);
            const closing = /^(?:---|\.\.\.)[ \t]*\r?$/m.exec(rest);
            if (!closing) throw new Error("Front matter has no closing delimiter");
            const parsed: unknown = parseYaml(rest.slice(0, closing.index));
            if (parsed != null) {
                if (typeof parsed !== "object" || Array.isArray(parsed)) {
                    throw new Error("Front matter must contain named fields");
                }
                original = parsed as Record<string, unknown>;
            }
        }

        const typeField = this.typeService.getTypeFieldName();
        let removed = 0;
        const retained = Object.entries(original).filter(([key, value]) => {
            const remove = key !== typeField && !typeInfo.definedFields.has(key) &&
                (options.removeFields === "all" || (options.removeFields === "empty" && isEmptyValue(value)));
            if (remove) removed++;
            return !remove;
        }).map(([key, value]): [string, unknown] => [key, key === typeField ? options.targetType : value]);
        const frontmatter: Record<string, unknown> = Object.fromEntries(retained);
        const defaults = options.addMissingFields ? new Map(typeInfo.fieldDefaults) : new Map<string, unknown>();
        // The assignment always sets the discriminator, even when adding fields is disabled.
        defaults.set(typeField, options.targetType);
        const fieldOrder = this.typeService.getFieldSortOrder(options.targetType) ?? typeInfo.fieldOrder;
        const mode = options.sortMode === "none" ? options.newFieldsPosition : options.sortMode;
        const added = this.insertFields(frontmatter, defaults, fieldOrder, mode);
        return { sourcePath, original, frontmatter, added, removed };
    }

    /** Apply a prepared assignment only if its metadata and source path still match. */
    async applyTypeAssignment(file: TFile, prepared: PreparedTypeAssignment): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
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

    /**
     * Sort frontmatter fields according to type definition order or alphabetically
     * @param file The file to sort
     * @param mode Sort mode: 'schema' for type definition order, 'alphabetical' for alphabetical, or 'default' to use settings
     */
    async sortFrontmatter(
        file: TFile,
        mode: "schema" | "alphabetical" | "default" = "default"
    ): Promise<void> {
        const frontmatter =
            this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        const typeValue = frontmatter[this.typeService.getTypeFieldName()] as string;

        // Determine effective mode
        const effectiveMode: SortMode =
            mode === "default" ? this.settings.defaultFieldSort : mode;

        const fieldOrder = typeValue
            ? this.typeService.getFieldSortOrder(typeValue)
            : (this.typeService.getPresetFieldInfo()?.fieldOrder ?? null);

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (!fm) return;

            const entries: [string, unknown][] = Object.entries(fm);
            const sorted = sortEntries(entries, fieldOrder, effectiveMode);

            // Rebuild in order
            for (const k of Object.keys(fm)) delete fm[k];
            for (const [k, v] of sorted) fm[k] = v;

            const orderSource =
                effectiveMode === "schema" && fieldOrder
                    ? "schema order"
                    : "alphabetical";
            new Notice(`Sorted ${sorted.length} field(s) (${orderSource})`);
        });
    }

    /**
     * Analyze what changes clean operation would make
     */
    analyzeCleanup(
        fm: Record<string, unknown>,
        typeInfo: TypeFieldInfo | null,
        options: CleanupOptions,
        schemaComplete: boolean = true
    ): CleanupAnalysis {
        const toRemove: CleanupAnalysis["toRemove"] = [];
        const toAdd: string[] = [];

        for (const key of Object.keys(fm)) {
            if (key === this.typeService.getTypeFieldName()) continue;

            const value = fm[key];
            const isEmpty = isEmptyValue(value);
            const isDefined = typeInfo?.definedFields.has(key) ?? false;

            let shouldRemove = false;

            if (isDefined) {
                // Schema field: only remove if empty AND not preserving
                if (isEmpty && !options.preserveDefinedFields) {
                    shouldRemove = true;
                }
            } else {
                // Non-schema field: remove if empty OR if removeUndefinedFields
                // (removeUndefinedFields only applies when schema is fully known)
                if (isEmpty || (options.removeUndefinedFields && typeInfo && schemaComplete)) {
                    shouldRemove = true;
                }
            }

            if (shouldRemove) {
                toRemove.push({ key, value, isEmpty });
            }
        }

        if (options.addMissingFields && typeInfo) {
            for (const fieldName of typeInfo.fieldDefaults.keys()) {
                if (!(fieldName in fm)) {
                    toAdd.push(fieldName);
                }
            }
        }

        return { toRemove, toAdd };
    }

    /**
     * Clean frontmatter according to type definition and options
     */
    async cleanFrontmatter(
        file: TFile,
        options: CleanupOptions = DEFAULT_CLEANUP_OPTIONS
    ): Promise<CleanupStats> {
        const frontmatter =
            this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        const typeValue = frontmatter[this.typeService.getTypeFieldName()] as string;

        const { typeInfo, schemaComplete } = this.typeService.resolveTypeInfo(typeValue || undefined);

        const stats: CleanupStats = { removed: [], added: [], preserved: [] };

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (!fm) return;

            // Phase 1: Remove fields
            for (const key of Object.keys(fm)) {
                if (key === this.typeService.getTypeFieldName()) continue;

                const isEmpty = isEmptyValue(fm[key]);
                const isDefined = typeInfo?.definedFields.has(key) ?? false;

                let shouldRemove = false;

                if (isDefined) {
                    if (isEmpty && !options.preserveDefinedFields) {
                        shouldRemove = true;
                    }
                } else {
                    if (isEmpty || (options.removeUndefinedFields && typeInfo && schemaComplete)) {
                        shouldRemove = true;
                    }
                }

                if (shouldRemove) {
                    stats.removed.push(key);
                    delete fm[key];
                } else if (isEmpty && isDefined) {
                    stats.preserved.push(key);
                }
            }

            // Phase 2: Add missing fields
            if (options.addMissingFields && typeInfo) {
                for (const [fieldName, defaultValue] of typeInfo.fieldDefaults) {
                    if (!(fieldName in fm)) {
                        fm[fieldName] = defaultValue;
                        stats.added.push(fieldName);
                    }
                }
            }

            // Phase 3: Sort
            if (options.sortMode !== "none") {
                const fieldOrder = typeValue
                    ? this.typeService.getFieldSortOrder(typeValue)
                    : null;

                const entries: [string, unknown][] = Object.entries(fm);
                const sorted = sortEntries(entries, fieldOrder, options.sortMode);

                for (const k of Object.keys(fm)) delete fm[k];
                for (const [k, v] of sorted) fm[k] = v;
            }
        });

        return stats;
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
