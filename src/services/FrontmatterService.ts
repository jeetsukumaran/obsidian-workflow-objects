import { App, TFile, Notice } from "obsidian";
import {
    WorkflowObjectsSettings,
    CleanupOptions,
    CleanupAnalysis,
    CleanupStats,
    TypeFieldInfo,
    DEFAULT_CLEANUP_OPTIONS,
} from "../types";
import { TypeService } from "./TypeService";
import { isEmptyValue, sortEntries, SortMode } from "../utils/helpers";

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
